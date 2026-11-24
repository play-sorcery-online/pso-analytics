export interface Rate { playerGames: number | null; matches: number | null; wins: number | null; winRate: number | null }
export interface CardRow {
  cardKey: string; cardName: string; deckShare: number | null
  inDeck: Rate; played: Rate; openingHand: Rate; inHand: Rate; notInHand: Rate; inDeckUnplayed: Rate
}
export interface CardMetadata { name: string; type: string; elements: readonly string[]; rarity: string; imageUrl?: string }
export type MetricKey = 'deckShare' | 'inDeck' | 'played' | 'openingHand' | 'inHand' | 'notInHand' | 'inDeckUnplayed' | 'winRateDifference'
export type SortKey = 'cardName' | MetricKey
export type SortDirection = 'ascending' | 'descending'
export interface CardTableFilters {
  search: string; type: string | readonly string[]; element: string | readonly string[]; rarity: string | readonly string[]
  minimums: Record<MetricKey, string>
  minimumValues?: Partial<Record<MetricKey, string>>
  /** Card keys from a pasted deck list; only these cards are shown when set. */
  deck?: ReadonlySet<string> | null
}

export const CARD_TABLE_LIMIT = 50
export const CARD_METRICS = [
  { key: 'deckShare', label: 'Deck share' },
  { key: 'inDeck', label: 'In deck win rate' },
  { key: 'played', label: 'Played win rate' },
  { key: 'openingHand', label: 'Opening hand win rate' },
  { key: 'inDeckUnplayed', label: 'In deck, not played' },
  { key: 'inHand', label: 'In hand win rate' },
  { key: 'notInHand', label: 'Not in hand win rate' },
  { key: 'winRateDifference', label: 'In hand vs. not in hand' },
] as const
export const EMPTY_MINIMUMS: Record<MetricKey, string> = {
  deckShare: '', inDeck: '', played: '', openingHand: '', inHand: '', notInHand: '', inDeckUnplayed: '', winRateDifference: '',
}

export function cardMetricValue(card: CardRow, key: MetricKey): number | null {
  if (key === 'deckShare') return card.deckShare
  if (key === 'winRateDifference') return card.inHand.winRate === null || card.notInHand.winRate === null
    ? null : card.inHand.winRate - card.notInHand.winRate
  return card[key].winRate
}

function cardMetricCount(card: CardRow, key: MetricKey): number | null {
  if (key === 'winRateDifference') return card.inHand.playerGames === null || card.notInHand.playerGames === null
    ? null : Math.min(card.inHand.playerGames, card.notInHand.playerGames)
  return card[key === 'deckShare' ? 'inDeck' : key].playerGames
}

export function minimumSample(value: string): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

/** Inputs use percentages (or percentage points for the difference), not fractions. */
export function minimumMetricValue(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number / 100 : null
}

function cardKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const DECK_LEADING_QUANTITY = /^(\d{1,3})\s*[x×]?\s+(.+)$/i
const DECK_TRAILING_QUANTITY = /^(.+?)\s+[x×]\s*(\d{1,3})$/i
const DECK_HEADER_COUNT = /\s*[([]\s*\d+\s*[)\]]\s*$/
const DECK_SECTIONS = new Set(['deck', 'main deck', 'maindeck', 'main', 'mainboard', 'avatar', 'avatars', 'spellbook', 'atlas'])
const SKIPPED_SECTIONS = new Set(['sideboard', 'side', 'collection', 'maybeboard', 'maybe', 'considering'])
const GROUP_HEADERS = new Set(['minion', 'minions', 'magic', 'magics', 'aura', 'auras', 'artifact', 'artifacts',
  'site', 'sites', 'spell', 'spells', 'other'])

export interface PastedDeckCard { key: string; name: string }

/**
 * Reads the deck's own cards from a pasted list ("3 Phase Assassin", "Phase Assassin x3",
 * or one name per line). Headers like "Atlas (20)" are skipped, and sideboard, collection
 * and maybeboard cards are left out. Each card appears once.
 */
export function parseDeckListCards(text: string): PastedDeckCard[] {
  const cards = new Map<string, PastedDeckCard>()
  let inDeck = true
  for (const raw of text.split(/\r?\n/).flatMap((line) => line.split(/\s+\/\s+(?=\d)/))) {
    const line = raw.replace(/^[\s*•·-]+/, '').trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    const leading = DECK_LEADING_QUANTITY.exec(line)
    const trailing = leading ? null : DECK_TRAILING_QUANTITY.exec(line)
    const name = (leading?.[2] ?? trailing?.[1])?.trim()
    if (!name) {
      const header = line.replace(DECK_HEADER_COUNT, '').replace(/:$/, '').trim().toLowerCase()
      if (DECK_SECTIONS.has(header)) { inDeck = true; continue }
      if (SKIPPED_SECTIONS.has(header)) { inDeck = false; continue }
      if (GROUP_HEADERS.has(header) || DECK_HEADER_COUNT.test(line) || line.endsWith(':')) continue
    }
    const cardName = name ?? line
    const key = cardKey(cardName)
    if (inDeck && key && !cards.has(key)) cards.set(key, { key, name: cardName })
  }
  return [...cards.values()]
}

export function indexCardMetadata(cards: readonly CardMetadata[]): Map<string, CardMetadata> {
  const result = new Map<string, CardMetadata>()
  for (const card of cards) if (!result.has(cardKey(card.name))) result.set(cardKey(card.name), card)
  return result
}

function filterValues(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [value].filter(Boolean) : value
}

function matchesElementFilter(elements: ReadonlySet<string>, filter: string): boolean {
  if (filter === 'None') return elements.size === 0
  if (filter === 'Multi') return elements.size >= 2
  return elements.has(filter.toLowerCase())
}

export function selectCardTable(
  cards: readonly CardRow[], catalog: ReadonlyMap<string, CardMetadata>, filters: CardTableFilters,
  sortKey: SortKey, direction: SortDirection, requestedPage = 1,
): { cards: CardRow[]; total: number; page: number; pageCount: number; start: number; end: number } {
  const search = cardKey(filters.search)
  const types = filterValues(filters.type)
  const rarities = filterValues(filters.rarity)
  const elementFilters = filterValues(filters.element)
  const minimums = CARD_METRICS.map(({ key }) => ({
    key, count: minimumSample(filters.minimums[key]), value: minimumMetricValue(filters.minimumValues?.[key]),
  }))
  const matched = cards.filter((card) => {
    if (filters.deck && !filters.deck.has(card.cardKey) && !filters.deck.has(cardKey(card.cardName))) return false
    if (search && !cardKey(card.cardName).includes(search)) return false
    if (minimums.some(({ key, count }) => count > 0
      && (cardMetricCount(card, key) ?? 0) < count)) return false
    if (minimums.some(({ key, value }) => {
      if (value === null) return false
      const actual = cardMetricValue(card, key)
      // Keep inclusive decimal thresholds stable after subtracting two rates.
      return actual === null || actual + 1e-12 < value
    })) return false
    const definition = catalog.get(card.cardKey) ?? catalog.get(cardKey(card.cardName))
    if (types.length > 0 && !types.includes(definition?.type ?? '')) return false
    if (rarities.length > 0 && !rarities.includes(definition?.rarity ?? '')) return false
    if (elementFilters.length > 0) {
      if (!definition) return false
      const elements = new Set(definition.elements.map((element) => element.toLowerCase()).filter((element) => element !== 'none'))
      if (!elementFilters.some((filter) => matchesElementFilter(elements, filter))) return false
    }
    return true
  })
  matched.sort((left, right) => {
    if (sortKey === 'cardName') return direction === 'ascending'
      ? left.cardName.localeCompare(right.cardName) : right.cardName.localeCompare(left.cardName)
    const a = cardMetricValue(left, sortKey)
    const b = cardMetricValue(right, sortKey)
    // Suppressed or unavailable rates stay last in either direction.
    if (a === null && b !== null) return 1
    if (a !== null && b === null) return -1
    if (a !== null && b !== null && a !== b) return direction === 'ascending' ? a - b : b - a
    return (right.inDeck.playerGames ?? 0) - (left.inDeck.playerGames ?? 0)
      || left.cardName.localeCompare(right.cardName)
  })
  const pageCount = Math.max(1, Math.ceil(matched.length / CARD_TABLE_LIMIT))
  const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1))
  const offset = (page - 1) * CARD_TABLE_LIMIT
  return { cards: matched.slice(offset, offset + CARD_TABLE_LIMIT), total: matched.length, page, pageCount,
    start: matched.length ? offset + 1 : 0, end: Math.min(offset + CARD_TABLE_LIMIT, matched.length) }
}
