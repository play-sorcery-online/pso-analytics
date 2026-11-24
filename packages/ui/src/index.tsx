import type { ReactNode } from 'react'
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CardMetadata, CardRow, MetricKey, Rate, SortDirection, SortKey } from './cardTable'
import type { AnalyticsPopulation } from './population'
import { LIMITED_SOURCE_LABELS } from './population'
import { CARD_METRICS, EMPTY_MINIMUMS, cardMetricValue, indexCardMetadata, minimumMetricValue, minimumSample, parseDeckListCards, selectCardTable } from './cardTable'
import { QueryBuilder } from './QueryBuilder'
import { SiteOpenings } from './SiteOpenings'
import { MetaMap } from './MetaMap'
import type { MetaMapShare, MetaMapWinRate } from './MetaMap'
export type { MetaMapShare, MetaMapWinRate } from './MetaMap'
export { toneClass, winRateTone } from './tone'
import { differenceTone, toneClass, winRateTone } from './tone'
import './style.css'

type Format = 'constructed' | 'limited'
interface CardsResponse extends AnalyticsPopulation {
  generatedAt: number
  totalPlayerGames: number | null; cards: CardRow[]
}
type ReplayColor = 'air' | 'earth' | 'fire' | 'water'
/** One Meta row. Endpoints may add fields that a host's `metaExtension` reads. */
export interface MetaRow { avatarKeys: string[]; colors: ReplayColor[] | null; metaShare: number; rate: Rate; readonly [field: string]: unknown }
export interface MetaResponse extends AnalyticsPopulation {
  generatedAt: number; totalPlayerGames: number; avatars: MetaRow[]; combinations: MetaRow[]; elements?: MetaRow[]
  readonly [field: string]: unknown
}
/** An extra Meta table column supplied by the host. */
export interface MetaColumn {
  key: string
  label: string
  /** Extra header content under the sort button, such as a threshold input. */
  header?: ReactNode
  /** Sort value; null sorts last. */
  value: (row: MetaRow) => number | null
  cell: (row: MetaRow) => ReactNode
}
/**
 * Host additions to the Meta tab, such as internal tools that are not part of this package.
 * Every field is optional; without it the Meta tab is unchanged.
 */
export interface MetaExtension {
  /** Appended to the Meta hint sentence. */
  hint?: string
  /** Rendered under the breakdown buttons. */
  controls?: ReactNode
  /** Rendered above the tables once Meta has loaded. */
  notes?: (meta: MetaResponse) => ReactNode
  /** Replaces `metaShare` for the share column, its bar and sorting. */
  share?: (row: MetaRow) => number | null
  hideRow?: (row: MetaRow) => boolean
  /** Inserted after the share column. */
  columns?: readonly MetaColumn[]
  /** Inserted after the win rate column. */
  trailingColumns?: readonly MetaColumn[]
  /** Replaces the all-games win rate on the Meta map and in highlights, such as one that weighs every player equally. */
  mapWinRate?: MetaMapWinRate
  /** Replaces the share of games on the Meta map and in highlights, so they match the table. */
  mapShare?: MetaMapShare
  /** Rendered at the top of the Meta tab; these choices drive the highlights, map and tables together. */
  topControls?: ReactNode
  tableClassName?: string
  /** Lets Avatar rows expand to show host content. */
  rowDetails?: { label: (name: string, expanded: boolean) => string; render: (row: MetaRow, avatarNames: string[]) => ReactNode }
}
/** An extra dashboard tab supplied by the host. */
export interface DashboardTabExtension {
  key: string
  label: string
  /** Heading id that links to the tab, without `#`. */
  anchor: string
  render: (context: { endpoint: string; query: string; active: boolean; replayBaseUrl: string }) => ReactNode
}
export interface GameTypeOption { value: string; label: string }
interface ReplayParticipant { avatarNames: string[]; colors: ReplayColor[] | null }
interface ReplayClipLink {
  clipId: string; finishedAt: number; won: boolean
  player?: ReplayParticipant | null; opponent?: ReplayParticipant | null
}
interface DashboardProps {
  endpoint: string
  title?: string
  /** Live data: hides the public release date and its guide entry. */
  live?: boolean
  replayBaseUrl?: string
  catalog?: readonly CardMetadata[]
  catalogError?: string | null
  /** Offer the limited set/cube filter; the endpoint must accept `limitedSource`. */
  limitedSourceFilter?: boolean
  /** Offer the card table's own-Avatar filter; the endpoint must accept `avatar`. */
  avatarFilter?: boolean
  /** One player's own live games across all game types. */
  personal?: boolean
  /** Render inside a host page: no Home link, page chrome, or top-level heading. */
  embedded?: boolean
  /** Offer the Site openings tab; the endpoint must serve `/site-openings`. */
  siteOpenings?: boolean
  /** Host controls shown beside the Home link. */
  headerControls?: ReactNode
  /** Where Meta loads from when it differs from `endpoint`. */
  metaUrl?: string
  /** Offer a Game type filter and the query builder's game type rule; the endpoint must accept `queueType`. */
  gameTypes?: readonly GameTypeOption[]
  /** Host additions to the Meta tab. */
  metaExtension?: MetaExtension
  /** Host tabs shown after the built-in ones. */
  extraTabs?: readonly DashboardTabExtension[]
  /** Controlled Game type selection; uncontrolled when omitted. */
  queue?: string
  onQueueChange?: (queue: string) => void
}

const EMPTY_CATALOG: readonly CardMetadata[] = []
const DASHBOARD_TABS = [
  { key: 'cards', label: 'Cards', anchor: 'card-analysis-title' },
  { key: 'query', label: 'Query data', anchor: 'combo-analysis-title' },
  { key: 'meta', label: 'Meta', anchor: 'meta-analysis-title' },
  { key: 'sites', label: 'Site openings', anchor: 'site-openings-title' },
] as const
interface TabEntry { key: string; label: string; anchor: string }

function tabFromLocation(tabs: readonly TabEntry[]): string {
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  return tabs.find(tab => `#${tab.anchor}` === hash)?.key ?? 'cards'
}

// Match PSO's existing affinity symbols without coupling the reusable UI to the host app.
const REPLAY_ELEMENT_SYMBOLS: Record<ReplayColor, { path: string; stroke: string; bar?: number }> = {
  air: { path: 'M50 10L90 80H10L50 10Z', stroke: '#B3B6D4', bar: 58 },
  earth: { path: 'M10 20H90L50 90L10 20Z', stroke: '#665845', bar: 42 },
  fire: { path: 'M50 10L90 80H10L50 10Z', stroke: '#86372B' },
  water: { path: 'M10 20H90L50 90L10 20Z', stroke: '#4D8FD6' },
}
const QUICK_FILTERS = [
  { key: 'type', label: 'Card type', options: ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'] },
  { key: 'element', label: 'Element', options: ['Earth', 'Fire', 'Water', 'Air', 'None', 'Multi'] },
  { key: 'rarity', label: 'Rarity', options: ['Unique', 'Elite', 'Exceptional', 'Ordinary'] },
] as const
type QuickFilterKey = typeof QUICK_FILTERS[number]['key']
type QuickFilterState = Record<QuickFilterKey, string[]>
const EMPTY_QUICK_FILTERS: QuickFilterState = { type: [], element: [], rarity: [] }
function quickFilterSelected(filters: QuickFilterState, key: QuickFilterKey, option: string): boolean {
  return filters[key].includes(option)
}
function toggleQuickFilter(filters: QuickFilterState, key: QuickFilterKey, option: string): QuickFilterState {
  const values = filters[key]
  return { ...filters, [key]: values.includes(option) ? values.filter((value) => value !== option) : [...values, option] }
}
const SORT_COLUMNS =[{ key: 'cardName', label: 'Card' }, ...CARD_METRICS] as const
const COLUMN_DESCRIPTIONS: Record<SortKey, string> = {
  cardName: 'Select a card to see its public replays.',
  deckShare: 'Percentage of player games where this card was in the deck.',
  inDeck: 'Win rate in player games where this card was in the deck.',
  played: 'Win rate in player games where this card was played at least once. Games without reliable play history are excluded.',
  openingHand: 'Win rate when this card was in the opening hand after the mulligan.',
  inHand: 'Win rate when this card was seen in the player’s hand after the mulligan, at any point in the game.',
  notInHand: 'Win rate when this card was in the deck but never seen in the player’s hand after the mulligan. Incomplete hand histories are excluded.',
  inDeckUnplayed: 'Win rate when this card was in the deck but not played. Uncertain play histories are excluded.',
  winRateDifference: 'In hand win rate minus not in hand win rate, in percentage points.',
}
const MINIMUM_LABELS: Record<MetricKey, string> = {
  deckShare: 'Deck share', inDeck: 'In deck', played: 'Played', openingHand: 'Opening hand', inHand: 'In hand',
  notInHand: 'Not in hand', inDeckUnplayed: 'Not played', winRateDifference: 'In hand vs. not in hand',
}
function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function rateCell(rate: Rate) {
  return rate.winRate === null ? '—' : <><span className={`game-analytics__pill ${toneClass(winRateTone(rate.winRate))}`}>{percent(rate.winRate)}</span><small className="game-analytics__sample">{rate.playerGames?.toLocaleString()} games</small></>
}

// Summary-first columns; the rest stay one click away under All stats.
const KEY_CARD_METRICS: readonly MetricKey[] = ['deckShare', 'inDeck', 'played', 'winRateDifference']
const CELL_TITLES: Partial<Record<MetricKey, string>> = {
  inHand: "Card seen in the player's hand after the mulligan, at any point in the game",
  notInHand: "Card in the deck but never seen in the player's hand after the mulligan; incomplete hand histories are excluded",
  winRateDifference: 'In hand win rate minus not in hand win rate (percentage points)',
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : many}`
}

function ShareBar({ value, max }: { value: number | null; max: number }) {
  return <span className="game-analytics__bar" aria-hidden="true">
    <span style={{ width: `${value === null || max <= 0 ? 0 : Math.max(2, Math.min(100, value / max * 100))}%` }} />
  </span>
}

function WinRateLegend() {
  return <p className="game-analytics__legend" aria-label="Win rate colors">
    <span>Win rate</span>
    <span className="ga-tone ga-tone--m3">Below 50%</span>
    <span className="ga-tone ga-tone--p0">About even</span>
    <span className="ga-tone ga-tone--p3">Above 50%</span>
  </p>
}

interface Highlight { key: string; label: string; name: string; value: string; detail: string; tone?: number | null; onSelect?: () => void }

function HighlightsInner({ title, note, items }: { title: string; note?: string; items: readonly Highlight[] }) {
  if (!items.length) return null
  return <section className="game-analytics__glance" aria-label={title}>
    <div className="game-analytics__glance-head"><h3>{title}</h3>{note ? <span className="game-analytics__sample">{note}</span> : null}</div>
    <ul>{items.map(item => {
      const body = <>
        <span className="game-analytics__glance-label">{item.label}</span>
        <span className="game-analytics__glance-name">{item.name}</span>
        <span className="game-analytics__glance-value"><strong className={toneClass(item.tone ?? null)}>{item.value}</strong> {item.detail}</span>
      </>
      return <li key={item.key}>{item.onSelect ? <button type="button" onClick={item.onSelect}
        title={`Find ${item.name} in the table`}>{body}</button> : <div>{body}</div>}</li>
    })}</ul>
  </section>
}

const Highlights = memo(HighlightsInner)

function minimumHighlightGames(counts: Array<number | null>): number {
  return counts.some(count => (count ?? 0) >= 100) ? 100 : 20
}

function pickBest<T>(items: readonly T[], score: (item: T) => number | null): T | null {
  let best: T | null = null
  let bestScore = -Infinity
  for (const item of items) {
    const value = score(item)
    if (value !== null && value > bestScore) { best = item; bestScore = value }
  }
  return best
}

function CardStatSheet({ card }: { card: CardRow }) {
  return <dl className="game-analytics__stat-sheet" aria-label={`All stats for ${card.cardName}`}>
    {CARD_METRICS.map(({ key, label }) => {
      if (key === 'deckShare') return <div key={key}><dt>{label}</dt><dd className="game-analytics__stat-value">{percent(card.deckShare)}</dd>
        <dd className="game-analytics__sample">{card.inDeck.playerGames === null ? 'Not enough games' : `${plural(card.inDeck.playerGames, 'player-game')} with it in the deck`}</dd></div>
      if (key === 'winRateDifference') return <div key={key}><dt>{label}</dt>
        <dd className={`game-analytics__stat-value ${toneClass(differenceTone(cardMetricValue(card, key)))}`}>{differenceLabel(card)}</dd>
        <dd className="game-analytics__sample">Drawn minus never drawn</dd></div>
      const rate = card[key]
      return <div key={key}><dt>{label}</dt>
        <dd className={`game-analytics__stat-value ${toneClass(winRateTone(rate.winRate))}`}>{percent(rate.winRate)}</dd>
        <dd className="game-analytics__sample">{rate.winRate === null || rate.playerGames === null ? 'Not enough games'
          : `${plural(rate.wins ?? 0, 'win')} in ${plural(rate.playerGames, 'game')}${rate.matches === null ? '' : ` · ${plural(rate.matches, 'match', 'matches')}`}`}</dd></div>
    })}
  </dl>
}

function CardArtworkInner({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const [failed, setFailed] = useState(false)
  return imageUrl && !failed ? <img className="game-analytics__card-art" src={imageUrl} alt={`${name} card art`}
    loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <p className="game-analytics__art-unavailable">Card art is unavailable.</p>
}

const CardArtwork = memo(CardArtworkInner)

function ReplayAvatarInner({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const [failed, setFailed] = useState(false)
  return imageUrl && !failed ? <img className="game-analytics__avatar-icon" src={imageUrl} alt={name}
    title={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className="game-analytics__avatar-icon game-analytics__avatar-icon--fallback" role="img" aria-label={name} title={name}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" />
      </svg>
    </span>
}

const ReplayAvatar = memo(ReplayAvatarInner)

interface ReplayMatchupSideProps {
  label: string
  participant?: ReplayParticipant | null
  avatarImages: ReadonlyMap<string, string | undefined>
  showAvatars?: boolean
}

function ReplayMatchupSideInner({ label, participant, avatarImages, showAvatars = true }: ReplayMatchupSideProps) {
  const names = participant?.avatarNames.length ? participant.avatarNames : ['Avatar unavailable']
  const colors = participant?.colors
  const description = `${label}: ${names.join(', ')} · ${colors == null ? 'Colors unavailable' : colors.length ? colors.join(', ') : 'Colorless'}`
  return <div className="game-analytics__matchup-side" role="group" aria-label={description} title={description}>
    {showAvatars ? <span className="game-analytics__avatar-stack">
      {names.map((name, index) => <ReplayAvatar key={`${name}-${index}-${avatarImages.get(name.toLowerCase()) ?? ''}`}
        name={name} imageUrl={avatarImages.get(name.toLowerCase())} />)}
    </span> : null}
    <ElementIcons colors={colors} />
  </div>
}

function ElementIconsInner({ colors }: { colors: ReplayColor[] | null | undefined }) {
  return <span className="game-analytics__colors">
      {colors == null ? <span className="game-analytics__color-unknown" role="img" aria-label="Colors unavailable" title="Colors unavailable">?</span>
        : colors.length === 0 ? <span className="game-analytics__colorless" role="img" aria-label="Colorless" title="Colorless">○</span>
          : colors.map((color) => {
            const symbol = REPLAY_ELEMENT_SYMBOLS[color]
            return <svg className="game-analytics__element-icon" key={color} role="img" aria-label={color}
              viewBox="0 0 100 100" fill="none" stroke={symbol.stroke} strokeWidth="8" strokeLinejoin="round">
              <title>{color}</title><path d={symbol.path} />
              {symbol.bar ? <line x1="10" y1={symbol.bar} x2="90" y2={symbol.bar} strokeLinecap="round" /> : null}
            </svg>
          })}
    </span>
}

const ElementIcons = memo(ElementIconsInner)

function elementsLabel(colors: ReplayColor[] | null): string {
  if (colors === null) return 'Elements unavailable'
  return colors.length ? colors.map(color => color[0]!.toUpperCase() + color.slice(1)).join(' + ') : 'Colorless'
}

const ReplayMatchupSide = memo(ReplayMatchupSideInner)


interface MetaTableProps {
  rows: MetaRow[]
  combinations?: boolean
  /** Rows group spellbook elements across all Avatars, so the element set is the row heading. */
  elements?: boolean
  extension?: MetaExtension
  avatarImages: ReadonlyMap<string, string | undefined>
  avatarNames: ReadonlyMap<string, string>
}

function MetaTableInner({ rows, combinations = false, elements = false, extension, avatarImages, avatarNames }: MetaTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = useCallback((id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])
  const [sort, setSort] = useState<string>('metaShare')
  const [direction, setDirection] = useState<SortDirection>('descending')
  const share = extension?.share ?? ((row: MetaRow) => row.metaShare)
  const extraColumns = extension?.columns ?? []
  const trailingColumns = extension?.trailingColumns ?? []
  const rowDetails = elements ? undefined : extension?.rowDetails
  const colorName = (row: MetaRow) => row.colors === null ? 'Colors unavailable' : row.colors.length ? row.colors.join(' + ') : 'Colorless'
  const name = (row: MetaRow) => elements ? elementsLabel(row.colors)
    : row.avatarKeys.map(key => avatarNames.get(key) ?? key).join(' + ') || 'Avatar unavailable'
  const sortValue = (row: MetaRow): string | number | null => sort === 'name' ? name(row) : sort === 'colors' ? colorName(row)
    : sort === 'metaShare' ? share(row) : sort === 'playerGames' || sort === 'winRate' ? row.rate[sort]
      : [...extraColumns, ...trailingColumns].find(column => column.key === sort)?.value(row) ?? null
  const sorted = [...rows].sort((a, b) => {
    const left = sortValue(a)
    const right = sortValue(b)
    if (left === null || right === null) return left === right ? name(a).localeCompare(name(b)) : left === null ? 1 : -1
    const order = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right)
    return (direction === 'ascending' ? order : -order) || name(a).localeCompare(name(b)) || colorName(a).localeCompare(colorName(b))
  })
  const maxShare = Math.max(0, ...rows.map(row => share(row) ?? 0))
  const columns: Array<{ key: string; label: string; header?: ReactNode }> = [
    { key: 'name', label: elements ? 'Elements' : 'Avatar' }, ...(combinations ? [{ key: 'colors', label: 'Spellbook colors' }] : []),
    { key: 'metaShare', label: 'Meta share' }, ...extraColumns, { key: 'playerGames', label: 'Player-games' }, { key: 'winRate', label: 'Win rate' },
    ...trailingColumns,
  ]
  return <div className="game-analytics__table-wrap" tabIndex={0} aria-label={elements ? 'Spellbook element meta' : combinations ? 'Avatar and spellbook color meta' : 'Avatar meta'}>
    <table className={`game-analytics__meta-table${combinations ? ' game-analytics__meta-table--combinations' : ''}${extension?.tableClassName ? ` ${extension.tableClassName}` : ''}`}>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col"
        aria-sort={sort === column.key ? direction : 'none'}>
        <button className="game-analytics__sort" type="button" onClick={() => {
          setSort(column.key)
          setDirection(sort === column.key ? direction === 'descending' ? 'ascending' : 'descending'
            : column.key === 'name' || column.key === 'colors' ? 'ascending' : 'descending')
        }}>{column.label}{sort === column.key ? direction === 'descending' ? ' ↓' : ' ↑' : ''}</button>
        {column.header ?? null}
      </th>)}</tr></thead>
      <tbody>{sorted.map(row => {
        const names = row.avatarKeys.map(key => avatarNames.get(key) ?? key)
        const rowId = JSON.stringify([row.avatarKeys, row.colors])
        const canExpand = Boolean(rowDetails) && row.avatarKeys.length > 0
        const isExpanded = canExpand && expanded.has(rowId)
        return <Fragment key={rowId}><tr>
          <th scope="row"><div className="game-analytics__meta-row-head">{canExpand ? <button type="button" className="game-analytics__summit-toggle"
            aria-expanded={isExpanded} aria-label={rowDetails!.label(name(row), isExpanded)}
            onClick={() => toggleExpanded(rowId)}>{isExpanded ? '▾' : '▸'}</button> : null}
          {elements ? <span className="game-analytics__meta-avatar">
            <ElementIcons colors={row.colors} />
            <span>{name(row)}</span>
          </span> : names.length > 2 ? <details className="game-analytics__meta-lineup">
            <summary><span className="game-analytics__meta-avatar">
              <span className="game-analytics__avatar-stack">{names.slice(0, 2).map(avatar =>
                <ReplayAvatar key={avatar} name={avatar} imageUrl={avatarImages.get(avatar.toLowerCase())} />)}
                <span className="game-analytics__avatar-overflow">+{names.length - 2}</span>
              </span>
              <span>{names.length}-Avatar lineup</span>
            </span></summary>
            <ul>{names.map(avatar => <li key={avatar}>{avatar}</li>)}</ul>
          </details> : <span className="game-analytics__meta-avatar">
            <span className="game-analytics__avatar-stack">{(names.length ? names : ['Avatar unavailable']).map(avatar =>
              <ReplayAvatar key={avatar} name={avatar} imageUrl={avatarImages.get(avatar.toLowerCase())} />)}</span>
            <span>{name(row)}</span>
          </span>}</div></th>
          {combinations ? <td className="game-analytics__meta-colors"><ReplayMatchupSide label={name(row)} participant={{ avatarNames: names, colors: row.colors }} avatarImages={avatarImages} showAvatars={false} />
            <span className="game-analytics__sample">{colorName(row)}</span></td> : null}
          <td data-label="Meta share" className="game-analytics__share-cell">{percent(share(row))}<ShareBar value={share(row)} max={maxShare} /></td>
          {extraColumns.map(column => <td key={column.key} data-label={column.label}>{column.cell(row)}</td>)}
          <td data-label="Player-games">{row.rate.playerGames?.toLocaleString() ?? '—'}</td>
          <td data-label="Win rate"><span className={`game-analytics__pill ${toneClass(winRateTone(row.rate.winRate))}`}>{percent(row.rate.winRate)}</span></td>
          {trailingColumns.map(column => <td key={column.key} data-label={column.label}>{column.cell(row)}</td>)}
        </tr>
        {isExpanded ? <tr className="game-analytics__summit-row"><td colSpan={columns.length}>
          {rowDetails!.render(row, names)}
        </td></tr> : null}</Fragment>
      })}</tbody>
    </table>
  </div>
}

const MetaTable = memo(MetaTableInner)

interface CardPaginationProps {
  page: number
  pageCount: number
  position: 'top' | 'bottom'
  onChange: (page: number, scrollToTable: boolean) => void
}

function CardPaginationInner({ page, pageCount, position, onChange }: CardPaginationProps) {
  if (pageCount <= 1) return null
  const selectPage = (value: number) => onChange(value, position === 'bottom')
  return <nav className="game-analytics__card-pagination" aria-label={`Card pages (${position})`}>
    <button type="button" disabled={page <= 1} onClick={() => selectPage(page - 1)}>← Previous</button>
    <select aria-label="Card page" value={page} onChange={(event) => selectPage(Number(event.target.value))}>
      {Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1} of {pageCount}</option>)}
    </select>
    <button type="button" disabled={page >= pageCount} onClick={() => selectPage(page + 1)}>Next →</button>
  </nav>
}

const CardPagination = memo(CardPaginationInner)

function differenceLabel(card: CardRow): string {
  const difference = cardMetricValue(card, 'winRateDifference')
  if (difference === null) return '—'
  const rounded = Math.round(difference * 1000) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} pp`
}

function selectionQuery(format: Format, from: string, through: string, queue: string, gameTypes: boolean, limitedSource: string): string {
  const params = new URLSearchParams({ format })
  if (from) params.set('from', from)
  if (through) params.set('through', through)
  if (gameTypes && queue !== 'all') params.set('queueType', queue)
  if (format === 'limited' && limitedSource !== 'all') params.set('limitedSource', limitedSource)
  return params.toString()
}

function GameAnalyticsDashboardInner({ endpoint, title = 'Game analytics', live = false,
  replayBaseUrl = 'https://playsorceryonline.com/replays', catalog = EMPTY_CATALOG, catalogError = null,
  limitedSourceFilter = false, avatarFilter = false, personal = false, embedded = false, siteOpenings = false,
  headerControls, queue: controlledQueue, onQueueChange, metaUrl, gameTypes, metaExtension, extraTabs }: DashboardProps) {
  const tabId = useId()
  const tabs = useMemo<TabEntry[]>(() => [...DASHBOARD_TABS.filter(tab => tab.key !== 'sites' || siteOpenings), ...extraTabs ?? []],
    [siteOpenings, extraTabs])
  const [activeTab, setActiveTab] = useState<string>(() => tabFromLocation(tabs))
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [format, setFormat] = useState<Format>('constructed')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [ownQueue, setOwnQueue] = useState('all')
  const queue = controlledQueue ?? ownQueue
  const setQueue = onQueueChange ?? setOwnQueue
  const [limitedSource, setLimitedSource] = useState('all')
  const effectiveLimitedSource = limitedSourceFilter ? limitedSource : 'all'
  const [cards, setCards] = useState<CardsResponse | null>(null)
  const [meta, setMeta] = useState<{ key: string; data: MetaResponse } | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaRetry, setMetaRetry] = useState(0)
  const [metaView, setMetaView] = useState<'avatars' | 'combinations' | 'elements'>('avatars')
  const [metaAvatarSearch, setMetaAvatarSearch] = useState('')
  const hideMetaRow = metaExtension?.hideRow
  const [queryPopulation, setQueryPopulation] = useState<{ key: string; data: AnalyticsPopulation | null } | null>(null)
  const receiveQueryPopulation = useCallback((key: string, data: AnalyticsPopulation | null) => {
    setQueryPopulation({ key, data })
  }, [])
  const [sitePopulation, setSitePopulation] = useState<{ key: string; data: AnalyticsPopulation | null } | null>(null)
  const receiveSitePopulation = useCallback((key: string, data: AnalyticsPopulation | null) => {
    setSitePopulation({ key, data })
  }, [])
  const loadedCardsFor = useRef<string | null>(null)
  const [cardsError, setCardsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cardAvatar, setCardAvatar] = useState('')
  const [quickFilters, setQuickFilters] = useState<QuickFilterState>({ ...EMPTY_QUICK_FILTERS })
  const [quickFiltersOpen, setQuickFiltersOpen] = useState(false)
  const [minimumsOpen, setMinimumsOpen] = useState(false)
  const [deckOpen, setDeckOpen] = useState(false)
  const [deckText, setDeckText] = useState('')
  const [minimums, setMinimums] = useState({ ...EMPTY_MINIMUMS })
  const [minimumValues, setMinimumValues] = useState({ ...EMPTY_MINIMUMS })
  const [showAllStats, setShowAllStats] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('deckShare')
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending')
  const [cardPage, setCardPage] = useState(1)
  const cardTableRef = useRef<HTMLDivElement>(null)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [replays, setReplays] = useState<ReplayClipLink[]>([])
  const [replaysLoading, setReplaysLoading] = useState(false)
  const [replaysError, setReplaysError] = useState<string | null>(null)
  const query = useMemo(() => selectionQuery(format, from, through, queue, Boolean(gameTypes), effectiveLimitedSource),
    [format, from, through, queue, gameTypes, effectiveLimitedSource])
  const populationKey = `${endpoint}?${query}`
  // The Avatar filter narrows only the card table and its replays, not the other tabs.
  const cardsQuery = avatarFilter && cardAvatar ? `${query}&${new URLSearchParams({ avatar: cardAvatar })}` : query
  const cardsKey = `${endpoint}?${cardsQuery}`
  const metaRequest = metaUrl ? `${metaUrl}${metaUrl.includes('?') ? '&' : '?'}${query}` : `${endpoint}/meta?${query}`
  const currentMeta = meta?.key === metaRequest ? meta.data : null
  const population = activeTab === 'meta' ? currentMeta
    : activeTab === 'sites' ? sitePopulation?.key === populationKey ? sitePopulation.data : null
      : queryPopulation?.key === populationKey && queryPopulation.data ? queryPopulation.data
        : loadedCardsFor.current === cardsKey ? cards : null
  const populationError = activeTab === 'meta' ? Boolean(metaError) : activeTab === 'sites' ? false
    : activeTab === 'query' ? queryPopulation?.key === populationKey && !queryPopulation.data : Boolean(cardsError)

  useEffect(() => {
    setMeta(null)
    setMetaError(null)
  }, [metaRequest])

  useEffect(() => {
    if (activeTab !== 'meta' || meta?.key === metaRequest) return
    const controller = new AbortController()
    setMetaLoading(true)
    setMetaError(null)
    const load = async () => {
      try {
        const response = await fetch(metaRequest, { signal: controller.signal })
        if (!response.ok) throw new Error('Meta analytics could not be loaded')
        const data = await response.json() as MetaResponse
        if (!controller.signal.aborted) setMeta({ key: metaRequest, data })
      } catch (error) {
        if (!controller.signal.aborted) setMetaError(error instanceof Error ? error.message : 'Could not load meta analytics')
      } finally { if (!controller.signal.aborted) setMetaLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [activeTab, metaRequest, metaRetry])

  useEffect(() => {
    const syncTab = () => setActiveTab(tabFromLocation(tabs))
    syncTab()
    window.addEventListener('hashchange', syncTab)
    return () => window.removeEventListener('hashchange', syncTab)
  }, [tabs])

  const chooseTab = (tab: TabEntry) => {
    setActiveTab(tab.key)
    // Preserve existing section links without scrolling past the shared controls.
    const url = new URL(window.location.href)
    url.hash = tab.anchor
    window.history.replaceState(window.history.state, '', url)
  }

  useEffect(() => {
    setCardPage(1)
    setSelectedCard(null)
  }, [endpoint, cardsQuery, search, quickFilters, minimums, minimumValues, sortKey, sortDirection, deckText])

  useEffect(() => {
    const key = cardsKey
    if (activeTab !== 'cards') return
    if (loadedCardsFor.current === key) { setLoading(false); setCardsError(null); return }
    const controller = new AbortController()
    setLoading(true)
    setCardsError(null)
    const load = async () => {
      try {
        const response = await fetch(`${endpoint}/cards?${cardsQuery}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Card analytics could not be loaded')
        const result = await response.json() as CardsResponse
        if (!controller.signal.aborted) { loadedCardsFor.current = key; setCards(result) }
      } catch (error) {
        if (!controller.signal.aborted) setCardsError(error instanceof Error ? error.message : 'Could not load analytics')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [activeTab, endpoint, cardsQuery, cardsKey])

  useEffect(() => {
    if (!selectedCard) return
    const controller = new AbortController()
    setReplays([]); setReplaysLoading(true); setReplaysError(null)
    const load = async () => {
      try {
        const response = await fetch(`${endpoint}/cards/${encodeURIComponent(selectedCard)}/replays?${cardsQuery}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Public replays could not be loaded.')
        const result = await response.json() as { replays: ReplayClipLink[] }
        if (!controller.signal.aborted) setReplays(result.replays)
      } catch {
        if (!controller.signal.aborted) setReplaysError('Public replays could not be loaded. Close and reopen this row to retry.')
      } finally { if (!controller.signal.aborted) setReplaysLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [endpoint, cardsQuery, selectedCard])
  const catalogIndex = useMemo(() => indexCardMetadata(catalog), [catalog])
  const avatarImages = useMemo(() => new Map(catalog.filter((card) => card.type === 'Avatar')
    .map((card) => [card.name.toLowerCase(), card.imageUrl])), [catalog])
  const avatarOptions = useMemo(() => [...new Set(catalog.filter(card => card.type === 'Avatar').map(card => card.name))]
    .sort((left, right) => left.localeCompare(right)), [catalog])
  const avatarNames = useMemo(() => new Map(catalog.filter(card => card.type === 'Avatar')
    .map(card => [card.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), card.name])), [catalog])
  const filteredMetaCombinations = useMemo(() => {
    const rows = (currentMeta?.combinations ?? []).filter(row => !hideMetaRow?.(row))
    const terms = metaAvatarSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter(row => {
      const names = row.avatarKeys.map(key => avatarNames.get(key) ?? key).join(' ').toLowerCase() || 'avatar unavailable'
      return terms.every(term => names.includes(term))
    })
  }, [currentMeta, metaAvatarSearch, avatarNames, hideMetaRow])
  const visibleMetaElements = useMemo(() => (currentMeta?.elements ?? [])
    .filter(row => !hideMetaRow?.(row)), [currentMeta, hideMetaRow])
  const visibleMetaAvatars = useMemo(() => (currentMeta?.avatars ?? [])
    .filter(row => !hideMetaRow?.(row)), [currentMeta, hideMetaRow])
  const deckCards = useMemo(() => parseDeckListCards(deckText), [deckText])
  const deckKeys = useMemo(() => deckCards.length ? new Set(deckCards.map(card => card.key)) : null, [deckCards])
  const deckMissing = useMemo(() => {
    if (!deckCards.length || !cards?.dataAvailable) return []
    const known = new Set(cards.cards.flatMap(card => [card.cardKey, card.cardName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()]))
    return deckCards.filter(card => !known.has(card.key)).map(card => card.name)
  }, [deckCards, cards])
  const cardTable = useMemo(() => selectCardTable(cards?.cards ?? [], catalogIndex,
    { search, ...quickFilters, minimums, minimumValues, deck: deckKeys }, sortKey, sortDirection, cardPage),
  [cards, catalogIndex, search, quickFilters, minimums, minimumValues, deckKeys, sortKey, sortDirection, cardPage])
  const visibleCards = cardTable.cards
  // A hidden column that is being sorted on stays visible so the order makes sense.
  const visibleMetrics = CARD_METRICS.filter(({ key }) => showAllStats || KEY_CARD_METRICS.includes(key) || key === sortKey)
  const maxDeckShare = useMemo(() => Math.max(0, ...(cards?.cards ?? []).map(card => card.deckShare ?? 0)), [cards])
  const cardHighlights = useMemo<Highlight[]>(() => {
    const rows = cards?.dataAvailable ? cards.cards : []
    if (!rows.length) return []
    const minimum = minimumHighlightGames(rows.map(card => card.played.playerGames))
    const find = (name: string) => () => setSearch(name)
    const items: Highlight[] = []
    const popular = pickBest(rows, card => card.deckShare)
    if (popular) items.push({ key: 'popular', label: 'Most included', name: popular.cardName, value: percent(popular.deckShare), detail: 'of decks', onSelect: find(popular.cardName) })
    const played = pickBest(rows, card => (card.played.playerGames ?? 0) >= minimum ? card.played.winRate : null)
    if (played) items.push({ key: 'played', label: 'Best when played', name: played.cardName, value: percent(played.played.winRate), detail: 'win rate', tone: winRateTone(played.played.winRate), onSelect: find(played.cardName) })
    const drawn = pickBest(rows, card => Math.min(card.inHand.playerGames ?? 0, card.notInHand.playerGames ?? 0) >= minimum ? cardMetricValue(card, 'winRateDifference') : null)
    if (drawn) items.push({ key: 'drawn', label: 'Biggest boost when drawn', name: drawn.cardName, value: differenceLabel(drawn), detail: 'vs. never drawn', tone: differenceTone(cardMetricValue(drawn, 'winRateDifference')), onSelect: find(drawn.cardName) })
    const low = pickBest(rows, card => (card.inDeck.playerGames ?? 0) >= minimum && card.inDeck.winRate !== null ? -card.inDeck.winRate : null)
    if (low) items.push({ key: 'low', label: 'Lowest win rate in deck', name: low.cardName, value: percent(low.inDeck.winRate), detail: 'win rate', tone: winRateTone(low.inDeck.winRate), onSelect: find(low.cardName) })
    return items
  }, [cards])
  const cardHighlightNote = cards?.dataAvailable && cards.cards.length
    ? `Win rates need ${minimumHighlightGames(cards.cards.map(card => card.played.playerGames))}+ games. Select one to find it.` : undefined
  const metaHighlights = useMemo<Highlight[]>(() => {
    const rows = currentMeta?.dataAvailable ? currentMeta.avatars.filter(row => row.avatarKeys.length) : []
    if (!rows.length) return []
    const nameOf = (row: MetaRow) => row.avatarKeys.map(key => avatarNames.get(key) ?? key).join(' + ')
    const minimum = minimumHighlightGames(rows.map(row => row.rate.playerGames))
    const items: Highlight[] = []
    const shareOf = metaExtension?.mapShare?.value ?? ((row: MetaRow) => row.metaShare)
    const winRateOf = metaExtension?.mapWinRate?.value ?? ((row: MetaRow) => row.rate.winRate)
    const popular = pickBest(rows, shareOf)
    if (popular) items.push({ key: 'popular', label: personal ? 'Your most played' : 'Most played Avatar', name: nameOf(popular),
      value: percent(shareOf(popular)), detail: metaExtension?.mapShare?.detail ?? 'of games' })
    const best = pickBest(rows, row => (row.rate.playerGames ?? 0) >= minimum ? winRateOf(row) : null)
    if (best) items.push({ key: 'best', label: `Best win rate (${minimum}+ games)`, name: nameOf(best), value: percent(winRateOf(best)),
      detail: metaExtension?.mapWinRate?.label ?? 'win rate', tone: winRateTone(winRateOf(best)) })
    const colors = pickBest(currentMeta?.elements ?? [], row => row.metaShare)
    if (colors) items.push({ key: 'colors', label: 'Most played elements', name: elementsLabel(colors.colors), value: percent(colors.metaShare), detail: 'of decks' })
    return items
  }, [currentMeta, avatarNames, personal, metaExtension])
  const changeCardPage = useCallback((page: number, scrollToTable: boolean) => {
    setCardPage(page)
    setSelectedCard(null)
    if (cardTableRef.current) cardTableRef.current.scrollTop = 0
    if (scrollToTable) {
      cardTableRef.current?.focus({ preventScroll: true })
      cardTableRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [])
  const quickFilterCount = quickFilters.type.length + quickFilters.element.length + quickFilters.rarity.length
  const minimumCount = Object.values(minimums).filter((value) => minimumSample(value) > 0).length
    + Object.values(minimumValues).filter((value) => minimumMetricValue(value) !== null).length
  const chooseSort = useCallback((key: SortKey) => {
    setSortKey(key)
    setSortDirection((current) => key === sortKey
      ? current === 'ascending' ? 'descending' : 'ascending'
      : key === 'cardName' ? 'ascending' : 'descending')
  }, [sortKey])
  const setMinimum = (key: MetricKey, value: string) => {
    if (value === '' || /^\d+$/.test(value)) setMinimums((current) => ({ ...current, [key]: value }))
  }

  const Root = embedded ? 'section' : 'main'
  const Title = embedded ? 'h2' : 'h1'
  return <Root className={`game-analytics${embedded ? ' game-analytics--embedded' : ''}`} aria-label={embedded ? title : undefined}>
    <div className="game-analytics__page">
      <header className="game-analytics__hero">
        {headerControls ? <div className="game-analytics__hero-top">
          {embedded ? <span /> : <a className="game-analytics__home" href="/">← Home</a>}{headerControls}
        </div> : embedded ? null : <a className="game-analytics__home" href="/">← Home</a>}
        <Title className="game-analytics__title">{title}</Title>
        <p className="game-analytics__intro">{personal ? 'How your cards and Avatars perform in your own games.'
          : 'How cards, Avatars and openings perform in real games. Start with the highlights, then open any row for the details.'}</p>
        <p className="game-analytics__release" aria-label="Dashboard data" aria-live="polite">
          {population ? <>
            {population.dataAvailable ? typeof population.totalGames === 'number'
              ? `${population.totalGames.toLocaleString()} ${population.totalGames === 1 ? 'game' : 'games'}` : 'Game count unavailable'
              : 'Analytics data not loaded'}
            {!live && population.releasedThrough ? <> · Released through {population.releasedThrough} UTC</> : null}
          </> : populationError ? 'Game count unavailable' : 'Loading game count…'}
        </p>
        <details className="game-analytics__guide">
          <summary>How to read these numbers</summary>
          <dl>
            <div><dt>Win rate</dt><dd>How often the player won. 50% is even: higher is green, lower is red, and stronger colors mean a bigger gap.</dd></div>
            <div><dt>Games</dt><dd>Each player in each game counts once, so one game between two players adds two player-games. Bigger samples are more reliable.</dd></div>
            <div><dt>Deck share and meta share</dt><dd>How often a card or Avatar shows up. The bar compares it with the most popular one.</dd></div>
            <div><dt>pp (percentage points)</dt><dd>The gap between two win rates. +5 pp means 55% compared with 50%.</dd></div>
            <div><dt>In hand / opening hand</dt><dd>Opening hand is what was kept after the mulligan. In hand also counts cards drawn later.</dd></div>
            {!live && !personal ? <div><dt>Release dates</dt><dd>Public results are released in batches, so the newest games appear after the next release date.</dd></div> : null}
          </dl>
        </details>
      </header>

      <div className="game-analytics__tabs" role="tablist" aria-label="Analytics views">
        {tabs.map((tab, index) => <button key={tab.key} type="button" role="tab"
          id={`${tabId}-tab-${tab.key}`} aria-controls={`${tabId}-panel-${tab.key}`}
          aria-selected={activeTab === tab.key} tabIndex={activeTab === tab.key ? 0 : -1}
          ref={element => { tabRefs.current[index] = element }} onClick={() => chooseTab(tab)}
          onKeyDown={event => {
            const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
            if (nextIndex === null) return
            event.preventDefault()
            chooseTab(tabs[nextIndex]!)
            tabRefs.current[nextIndex]?.focus()
          }}>{tab.key === 'meta' && personal ? 'Avatars' : tab.label}</button>)}
      </div>

      <section className="game-analytics__controls" aria-label="Data selection">
        <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as Format)}>
          <option value="constructed">Constructed</option><option value="limited">Limited</option>
        </select></label>
        {limitedSourceFilter && format === 'limited' ? <label title="Inferred from the cards in each player's deck">Set or cube
          <select value={limitedSource} onChange={(event) => setLimitedSource(event.target.value)}>
            <option value="all">All sets and cubes</option>
            {Object.entries(LIMITED_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label> : null}
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Through<input type="date" value={through} onChange={(event) => setThrough(event.target.value)} /></label>
        {gameTypes ? <label>Game type<select value={queue} onChange={(event) => setQueue(event.target.value)}>
          <option value="all">All</option>
          {gameTypes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label> : null}
      </section>

      <section className="game-analytics__panel" role="tabpanel" id={`${tabId}-panel-cards`}
        aria-labelledby={`${tabId}-tab-cards`} hidden={activeTab !== 'cards'}>
        <div className="game-analytics__panel-heading">
          <h2 id="card-analysis-title">Performance by card</h2>
          {!loading && cards?.dataAvailable ? <span className="game-analytics__card-count" role="status">
            {cardTable.total ? `Showing ${cardTable.start.toLocaleString()}–${cardTable.end.toLocaleString()} of ${cardTable.total.toLocaleString()} matching cards` : '0 matching cards'}
          </span> : null}
        </div>
        <p className="game-analytics__hint">Each row is a card. Win rates show how often players won with it in their deck, played, or drawn. Select a card for all of its stats and replays.</p>
        {!loading ? <Highlights title="At a glance" note={cardHighlightNote} items={cardHighlights} /> : null}
        <div className="game-analytics__card-tools">
          <input aria-label="Search cards" placeholder="Search cards" value={search} onChange={(event) => setSearch(event.target.value)} />
          {avatarFilter && avatarOptions.length ? <select aria-label="Your Avatar" title="Only games where the player's own Avatar was this one"
            value={cardAvatar} onChange={(event) => setCardAvatar(event.target.value)}>
            <option value="">Any Avatar</option>
            {avatarOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select> : null}
          <div className="game-analytics__filter-toggles">
            <button type="button" aria-expanded={quickFiltersOpen} aria-controls={`${tabId}-quick-filters`}
              onClick={() => setQuickFiltersOpen(current => !current)}>
              <span className="game-analytics__disclosure-arrow" aria-hidden="true">{quickFiltersOpen ? '▾' : '▸'}</span>
              <span>Quick filters</span>{quickFilterCount > 0 ? <span className="game-analytics__filter-count">{quickFilterCount}</span> : null}
            </button>
            <button type="button" aria-expanded={minimumsOpen} aria-controls={`${tabId}-column-minimums`}
              onClick={() => setMinimumsOpen(current => !current)}>
              <span className="game-analytics__disclosure-arrow" aria-hidden="true">{minimumsOpen ? '▾' : '▸'}</span>
              <span>Column minimums</span>{minimumCount > 0 ? <span className="game-analytics__filter-count">{minimumCount}</span> : null}
            </button>
            <button type="button" aria-expanded={deckOpen} aria-controls={`${tabId}-deck-list`}
              onClick={() => setDeckOpen(current => !current)}>
              <span className="game-analytics__disclosure-arrow" aria-hidden="true">{deckOpen ? '▾' : '▸'}</span>
              <span>Your deck</span>{deckCards.length > 0 ? <span className="game-analytics__filter-count">{deckCards.length}</span> : null}
            </button>
          </div>
          {search || cardAvatar || quickFilterCount || minimumCount || deckText ? <button type="button" className="game-analytics-text-button" onClick={() => {
            setSearch(''); setCardAvatar(''); setQuickFilters({ ...EMPTY_QUICK_FILTERS }); setMinimums({ ...EMPTY_MINIMUMS }); setMinimumValues({ ...EMPTY_MINIMUMS }); setDeckText('')
          }}>Clear filters</button> : null}
        </div>
        <div className="game-analytics__deck-list" id={`${tabId}-deck-list`} hidden={!deckOpen}>
          <label htmlFor={`${tabId}-deck-list-text`}>Paste a deck list to show only its cards</label>
          <textarea id={`${tabId}-deck-list-text`} rows={6} spellCheck={false} value={deckText}
            placeholder={'1 Sorcerer\n4 Phase Assassin\n2 Ring of Morrigan'} onChange={(event) => setDeckText(event.target.value)} />
          <p>One card per line, like "3 Phase Assassin". Sideboard and maybeboard cards are left out.
            {deckCards.length ? ` ${plural(deckCards.length, 'card')} in your list.` : ''}</p>
          {deckMissing.length ? <p>No games yet for: {deckMissing.join(', ')}</p> : null}
          {deckText ? <button type="button" className="game-analytics-text-button" onClick={() => setDeckText('')}>Clear deck</button> : null}
        </div>
        <div className="game-analytics__quick-filters" id={`${tabId}-quick-filters`} hidden={!quickFiltersOpen}>
          {catalogError ? <p role="alert">{catalogError}</p> : catalog.length === 0 ? <p>Loading card filters…</p> :
            QUICK_FILTERS.map(({ key, label, options }) => <div key={key} role="group" aria-label={label}>
              <span>{label}</span>
              {options.map((option) => <button type="button" key={option} aria-pressed={quickFilterSelected(quickFilters, key, option)}
                onClick={() => setQuickFilters((current) => toggleQuickFilter(current, key, option))}>{option}</button>)}
            </div>)}
        </div>
        <div className="game-analytics__minimums" id={`${tabId}-column-minimums`} hidden={!minimumsOpen} role="group" aria-label="Column minimums">
          <div className="game-analytics__minimum-grid">
            <span className="game-analytics__minimum-heading">Column</span>
            <span className="game-analytics__minimum-heading">Min. games</span>
            <span className="game-analytics__minimum-heading">Min. value</span>
            {CARD_METRICS.map(({ key, label }) => <Fragment key={key}>
              <label htmlFor={`analytics-minimum-${key}`} title={label}>{MINIMUM_LABELS[key]}</label>
              <input id={`analytics-minimum-${key}`} aria-label={`Minimum ${label.toLowerCase()} games`} type="number" min="0" step="1" inputMode="numeric"
                placeholder="0" value={minimums[key]} onChange={(event) => setMinimum(key, event.target.value)} />
              <div className="game-analytics__minimum-value">
                <input aria-label={`Minimum ${label.toLowerCase()} value (${key === 'winRateDifference' ? 'pp' : '%'})`}
                  type="number" min={key === 'winRateDifference' ? -100 : 0} max="100" step="any"
                  inputMode={key === 'winRateDifference' ? undefined : 'decimal'} placeholder="Any" value={minimumValues[key]}
                  onChange={(event) => setMinimumValues((current) => ({ ...current, [key]: event.target.value }))} />
                <span aria-hidden="true">{key === 'winRateDifference' ? 'pp' : '%'}</span>
              </div>
            </Fragment>)}
          </div>
          <p>All limits apply together. Blank values have no limit. In hand vs. not in hand uses percentage points (pp).</p>
          <p>Samples count player-games. Deck share uses in-deck games; the difference requires both groups to meet the minimum.</p>
        </div>
        {quickFilterCount > 0 ? <div className="game-analytics__active-filters" aria-label="Active card filters">
          {QUICK_FILTERS.flatMap(({ key, label }) => quickFilters[key].map((value) => <button type="button" key={`${key}:${value}`}
            aria-label={`Remove ${label.toLowerCase()} filter: ${value}`}
            onClick={() => setQuickFilters((current) => toggleQuickFilter(current, key, value))}>{value} <span aria-hidden="true">×</span></button>))}
        </div> : null}
        <div className="game-analytics__mobile-sort">
          <label>Sort by<select value={sortKey} onChange={(event) => chooseSort(event.target.value as SortKey)}>
            {SORT_COLUMNS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <button type="button" onClick={() => setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}>
            {sortDirection === 'ascending' ? '↑ Ascending' : '↓ Descending'}
          </button>
        </div>
        {cardsError ? <p role="alert" className="game-analytics__error">{cardsError}</p> : null}
        {loading ? <p>Loading cards…</p> : !cards?.dataAvailable ? <p>Analytics data has not been loaded yet.</p>
          : visibleCards.length === 0 ? <p>No cards match this selection.</p>
            : <>
            <div className="game-analytics__table-bar">
              <div className="game-analytics__segmented" role="group" aria-label="Table columns">
                <button type="button" aria-pressed={!showAllStats} onClick={() => setShowAllStats(false)}>Key stats</button>
                <button type="button" aria-pressed={showAllStats} onClick={() => setShowAllStats(true)}>All stats</button>
              </div>
              <WinRateLegend />
              <CardPagination page={cardTable.page} pageCount={cardTable.pageCount} position="top" onChange={changeCardPage} />
            </div>
            <div className="game-analytics__table-wrap game-analytics__table-wrap--cards" ref={cardTableRef} role="region" aria-label="Card performance table" tabIndex={0}><table className={`game-analytics__card-table${showAllStats ? '' : ' game-analytics__card-table--key'}`}><thead><tr>
              {[SORT_COLUMNS[0], ...visibleMetrics].map(({ key, label }) => <th key={key} scope="col" aria-label={label} aria-sort={sortKey === key ? sortDirection : 'none'}>
                <span className="game-analytics__column-heading">
                  <button type="button" className="game-analytics__sort" onClick={() => chooseSort(key)}>
                    {label}<span aria-hidden="true">{sortKey === key ? sortDirection === 'ascending' ? '↑' : '↓' : '↕'}</span>
                  </button>
                  <button type="button" className="game-analytics__column-help" aria-label={`${label}: ${COLUMN_DESCRIPTIONS[key]}`}>
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
                      <circle cx="8" cy="4.75" r=".8" fill="currentColor" />
                      <path d="M8 7.25v4.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    <span className="game-analytics__column-tooltip" aria-hidden="true">{COLUMN_DESCRIPTIONS[key]}</span>
                  </button>
                </span>
              </th>)}
            </tr></thead><tbody>{visibleCards.map((card) => <Fragment key={card.cardKey}><tr className={selectedCard === card.cardKey ? 'game-analytics__card-row--expanded' : undefined}>
              <th scope="row"><button type="button" className="game-analytics__expand" aria-expanded={selectedCard === card.cardKey}
                aria-controls={selectedCard === card.cardKey ? `card-details-${card.cardKey.replaceAll(' ', '-')}` : undefined}
                onClick={() => setSelectedCard((current) => current === card.cardKey ? null : card.cardKey)}>
                <span aria-hidden="true">{selectedCard === card.cardKey ? '−' : '+'}</span>{card.cardName}</button></th>
              {visibleMetrics.map(({ key }) => key === 'deckShare'
                ? <td key={key} data-label={MINIMUM_LABELS[key]} className="game-analytics__share-cell">{percent(card.deckShare)}<ShareBar value={card.deckShare} max={maxDeckShare} /></td>
                : key === 'winRateDifference'
                  ? <td key={key} data-label={MINIMUM_LABELS[key]} title={CELL_TITLES[key]}><span className={`game-analytics__pill ${toneClass(differenceTone(cardMetricValue(card, key)))}`}>{differenceLabel(card)}</span></td>
                  : <td key={key} data-label={MINIMUM_LABELS[key]} title={CELL_TITLES[key]}>{rateCell(card[key])}</td>)}
            </tr>{selectedCard === card.cardKey ? <tr className="game-analytics__details-row"><td colSpan={visibleMetrics.length + 1}>
              <div className="game-analytics__card-details" id={`card-details-${card.cardKey.replaceAll(' ', '-')}`}>
                <CardArtwork key={`${card.cardKey}-${catalogIndex.get(card.cardKey)?.imageUrl ?? ''}`}
                  name={card.cardName} imageUrl={catalogIndex.get(card.cardKey)?.imageUrl} />
                <div className="game-analytics__card-detail-body">
                <CardStatSheet card={card} />
                <div className="game-analytics__replays"><h3>Public replays · {card.cardName}</h3>
                  {replaysLoading ? <p role="status">Loading public replays…</p> : replaysError ? <p role="alert">{replaysError}</p>
                    : replays.length === 0 ? <p>No public replay links are available for this selection.</p> : <ul>
                      {replays.map((replay) => <li key={replay.clipId}>
                        <a className="game-analytics__replay-link" href={`${new URL('/replay-clips', replayBaseUrl).toString()}/${encodeURIComponent(replay.clipId)}`} target="_blank" rel="noreferrer"
                          aria-label={`${new Date(replay.finishedAt).toLocaleDateString()} · ${replay.won ? 'Win' : 'Loss'} · watch play`}
                          title="Opens one step before the play. Result is for the card player, shown on the left.">
                          <span className="game-analytics__replay-meta">
                            <time dateTime={new Date(replay.finishedAt).toISOString()}>{new Date(replay.finishedAt).toLocaleDateString()}</time>
                            <span className={`game-analytics__replay-result ${replay.won ? 'is-win' : 'is-loss'}`}>{replay.won ? 'Win' : 'Loss'}</span>
                          </span>
                          <span className="game-analytics__replay-action">Watch play <span aria-hidden="true">↗</span></span>
                          <span className="game-analytics__matchup" aria-label="Replay matchup">
                            <ReplayMatchupSide label="Player" participant={replay.player} avatarImages={avatarImages} />
                            <span className="game-analytics__versus" aria-hidden="true">vs</span>
                            <ReplayMatchupSide label="Opponent" participant={replay.opponent} avatarImages={avatarImages} />
                          </span>
                        </a>
                      </li>)}</ul>}
                </div>
                </div>
              </div>
            </td></tr> : null}</Fragment>)}</tbody></table></div>
            <CardPagination page={cardTable.page} pageCount={cardTable.pageCount} position="bottom" onChange={changeCardPage} /></>}
      </section>

      <section className="game-analytics__panel" role="tabpanel" id={`${tabId}-panel-meta`}
        aria-labelledby={`${tabId}-tab-meta`} hidden={activeTab !== 'meta'}>
        <h2 id="meta-analysis-title">{personal ? 'Avatars' : 'Meta'}</h2>
        <p className="game-analytics__hint">{personal ? 'Which Avatars and spellbook colors you play, and how often you win with them.'
          : 'Which Avatars and spellbook colors people play, and how often they win.'}{metaExtension?.hint ?? ''}</p>
        {metaExtension?.topControls ?? null}
        {currentMeta?.dataAvailable && currentMeta.totalPlayerGames ? <>
          <Highlights title="At a glance" items={metaHighlights} />
          <MetaMap rows={currentMeta.avatars} avatarNames={avatarNames} endpoint={endpoint} query={query}
            releasedThrough={currentMeta.releasedThrough} personal={personal} altWinRate={metaExtension?.mapWinRate} shareAxis={metaExtension?.mapShare} />
        </> : null}
        <div className="game-analytics__meta-views" role="group" aria-label="Meta breakdown">
          <button type="button" aria-pressed={metaView === 'avatars'} onClick={() => setMetaView('avatars')}>Avatars</button>
          <button type="button" aria-pressed={metaView === 'combinations'} onClick={() => setMetaView('combinations')}>Avatars + colors</button>
          <button type="button" aria-pressed={metaView === 'elements'} onClick={() => setMetaView('elements')}>Elements</button>
        </div>
        {metaExtension?.controls ?? null}
        {metaError ? <p role="alert">{metaError} <button type="button" onClick={() => setMetaRetry(value => value + 1)}>Try again</button></p>
          : metaLoading || !currentMeta ? <p role="status">Loading meta analytics…</p>
            : !currentMeta.dataAvailable ? <p role="status">Analytics data not loaded.</p>
              : !currentMeta.totalPlayerGames ? <p>No eligible games in this selection.</p>
                : <>
                  <div className="game-analytics__table-bar">
                    <p className="game-analytics__card-count">{currentMeta.totalPlayerGames.toLocaleString()} player-games</p>
                    <WinRateLegend />
                  </div>
                  {metaExtension?.notes?.(currentMeta) ?? null}
                  <div hidden={metaView !== 'avatars'}>
                    <h3>Avatars by meta share</h3>
                    <MetaTable rows={visibleMetaAvatars} extension={metaExtension} avatarImages={avatarImages} avatarNames={avatarNames} />
                  </div>
                  <div hidden={metaView !== 'elements'}>
                    <h3>Spellbook elements by meta share</h3>
                    <p className="game-analytics__sample">Each deck is grouped by every element its spells need, from their thresholds. Sites and Avatars don't count.</p>
                    {!currentMeta.elements ? <p role="status">Element breakdown is still loading. Refresh in a few minutes.</p>
                      : <MetaTable rows={visibleMetaElements} elements extension={metaExtension} avatarImages={avatarImages} avatarNames={avatarNames} />}
                  </div>
                  <div hidden={metaView !== 'combinations'}>
                    <h3>Avatars and spellbook colors by meta share</h3>
                    <div className="game-analytics__card-tools">
                      <input type="search" aria-label="Search avatar names" placeholder="Search avatar names"
                        value={metaAvatarSearch} onChange={event => setMetaAvatarSearch(event.target.value)} />
                      <span className="game-analytics__card-count" role="status">
                        Showing {filteredMetaCombinations.length.toLocaleString()} of {currentMeta.combinations.length.toLocaleString()} combinations
                      </span>
                    </div>
                    {!filteredMetaCombinations.length ? <p>No avatars match your search.</p> : null}
                    <div hidden={!filteredMetaCombinations.length}>
                      <MetaTable rows={filteredMetaCombinations} combinations extension={metaExtension} avatarImages={avatarImages} avatarNames={avatarNames} />
                    </div>
                  </div>
                </>}
      </section>

      {siteOpenings ? <div role="tabpanel" id={`${tabId}-panel-sites`} aria-labelledby={`${tabId}-tab-sites`} hidden={activeTab !== 'sites'}>
        <SiteOpenings endpoint={endpoint} query={query} active={activeTab === 'sites'} avatarOptions={avatarOptions}
          onPopulation={receiveSitePopulation} />
      </div> : null}
      <div role="tabpanel" id={`${tabId}-panel-query`} aria-labelledby={`${tabId}-tab-query`} hidden={activeTab !== 'query'}>
        <QueryBuilder endpoint={endpoint} query={query} gameTypes={Boolean(gameTypes)} personal={personal} active={activeTab === 'query'} catalog={catalog} catalogError={catalogError}
          onPopulation={receiveQueryPopulation} />
      </div>
      {extraTabs?.map(tab => <section key={tab.key} className="game-analytics__panel" role="tabpanel" id={`${tabId}-panel-${tab.key}`}
        aria-labelledby={`${tabId}-tab-${tab.key}`} hidden={activeTab !== tab.key}>
        {tab.render({ endpoint, query, active: activeTab === tab.key, replayBaseUrl })}
      </section>)}
    </div>
  </Root>
}

export const GameAnalyticsDashboard = memo(GameAnalyticsDashboardInner)
