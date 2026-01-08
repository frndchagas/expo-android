export type Bounds = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type Center = {
  x: number;
  y: number;
};

export type UIElement = {
  index: number;
  text: string;
  class: string;
  resourceId: string;
  contentDesc: string;
  bounds: Bounds;
  center: Center;
  checkable: boolean;
  checked: boolean;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  scrollable: boolean;
  selected: boolean;
};

export type FindCriteria = {
  text?: string;
  textContains?: string;
  class?: string;
  resourceId?: string;
  resourceIdContains?: string;
  contentDesc?: string;
  contentDescContains?: string;
  checkable?: boolean;
  clickable?: boolean;
  normalizeWhitespace?: boolean;
  caseInsensitive?: boolean;
};

const ENTITY_MAP: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
};

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|amp|lt|gt|apos);/g, (_, entity) => {
    if (entity.startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    }
    return ENTITY_MAP[entity] ?? '';
  });
}

function parseAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = match[1];
    const value = decodeXml(match[2]);
    attrs[key] = value;
  }
  return attrs;
}

function parseBounds(value: string | undefined): Bounds | null {
  if (!value) return null;
  const match = value.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1).map((num) => Number.parseInt(num, 10));
  if ([x1, y1, x2, y2].some((num) => Number.isNaN(num))) return null;
  return { x1, y1, x2, y2 };
}

function toBoolean(value: string | undefined) {
  return value === 'true';
}

function defaultBounds(): Bounds {
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function centerFromBounds(bounds: Bounds): Center {
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

export function parseUIElements(xml: string): UIElement[] {
  const elements: UIElement[] = [];
  let fallbackIndex = 0;
  const nodeRegex = /<node\b[^>]*>/g;

  for (const match of xml.matchAll(nodeRegex)) {
    const tag = match[0];
    const attrs = parseAttributes(tag);
    const bounds = parseBounds(attrs.bounds) ?? defaultBounds();
    const center = centerFromBounds(bounds);
    const parsedIndex = Number.parseInt(attrs.index ?? '', 10);
    const index = Number.isFinite(parsedIndex) ? parsedIndex : fallbackIndex;

    elements.push({
      index,
      text: attrs.text ?? '',
      class: attrs.class ?? '',
      resourceId: attrs['resource-id'] ?? '',
      contentDesc: attrs['content-desc'] ?? '',
      bounds,
      center,
      checkable: toBoolean(attrs.checkable),
      checked: toBoolean(attrs.checked),
      clickable: toBoolean(attrs.clickable),
      enabled: toBoolean(attrs.enabled),
      focused: toBoolean(attrs.focused),
      scrollable: toBoolean(attrs.scrollable),
      selected: toBoolean(attrs.selected),
    });

    fallbackIndex += 1;
  }

  return elements;
}

function isInteractive(element: UIElement) {
  return element.clickable || element.checkable || element.scrollable;
}

function elementLabel(element: UIElement) {
  return (
    element.text ||
    element.contentDesc ||
    element.resourceId ||
    element.class ||
    `#${element.index}`
  );
}

export function generateSummary(elements: UIElement[]) {
  if (elements.length === 0) {
    return 'No UI elements found.';
  }

  const interactive = elements.filter(isInteractive);
  const summaryItems = interactive.slice(0, 8).map((element, index) => {
    const flags = [
      element.clickable ? 'clickable' : null,
      element.checkable ? 'checkable' : null,
      element.scrollable ? 'scrollable' : null,
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    return `${index + 1}. ${elementLabel(element)}${suffix}`;
  });

  const base = `Found ${elements.length} elements (${interactive.length} interactive).`;
  if (summaryItems.length === 0) return base;

  return `${base} Interactive: ${summaryItems.join(' | ')}`;
}

function normalizeValue(value: string, criteria: FindCriteria) {
  let normalized = value;
  if (criteria.normalizeWhitespace) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }
  if (criteria.caseInsensitive) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export function findElements(elements: UIElement[], criteria: FindCriteria) {
  return elements.filter((element) => {
    const textValue = normalizeValue(element.text, criteria);
    const contentDescValue = normalizeValue(element.contentDesc, criteria);
    const textCriteria =
      criteria.text !== undefined
        ? normalizeValue(criteria.text, criteria)
        : undefined;
    const textContainsCriteria =
      criteria.textContains !== undefined
        ? normalizeValue(criteria.textContains, criteria)
        : undefined;
    const contentDescCriteria =
      criteria.contentDesc !== undefined
        ? normalizeValue(criteria.contentDesc, criteria)
        : undefined;
    const contentDescContainsCriteria =
      criteria.contentDescContains !== undefined
        ? normalizeValue(criteria.contentDescContains, criteria)
        : undefined;
    const resourceIdValue = criteria.caseInsensitive
      ? element.resourceId.toLowerCase()
      : element.resourceId;
    const resourceIdCriteria = criteria.resourceId
      ? criteria.caseInsensitive
        ? criteria.resourceId.toLowerCase()
        : criteria.resourceId
      : undefined;
    const resourceIdContainsCriteria = criteria.resourceIdContains
      ? criteria.caseInsensitive
        ? criteria.resourceIdContains.toLowerCase()
        : criteria.resourceIdContains
      : undefined;

    if (textCriteria !== undefined && textValue !== textCriteria) {
      return false;
    }
    if (
      textContainsCriteria !== undefined &&
      !textValue.includes(textContainsCriteria)
    ) {
      return false;
    }
    if (
      criteria.class !== undefined &&
      (criteria.caseInsensitive
        ? element.class.toLowerCase() !== criteria.class.toLowerCase()
        : element.class !== criteria.class)
    ) {
      return false;
    }
    if (contentDescCriteria !== undefined && contentDescValue !== contentDescCriteria) {
      return false;
    }
    if (
      contentDescContainsCriteria !== undefined &&
      !contentDescValue.includes(contentDescContainsCriteria)
    ) {
      return false;
    }
    if (resourceIdCriteria !== undefined && resourceIdValue !== resourceIdCriteria) {
      return false;
    }
    if (
      resourceIdContainsCriteria !== undefined &&
      !resourceIdValue.includes(resourceIdContainsCriteria)
    ) {
      return false;
    }
    if (
      criteria.checkable !== undefined &&
      element.checkable !== criteria.checkable
    ) {
      return false;
    }
    if (
      criteria.clickable !== undefined &&
      element.clickable !== criteria.clickable
    ) {
      return false;
    }
    return true;
  });
}
