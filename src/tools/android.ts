import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { adbExec, adbExecOut, adbShell } from '../adb.js';
import {
  findElements,
  generateSummary,
  parseUIElements,
  type FindCriteria,
  type UIElement,
} from '../ui-parser.js';

function toText(value: string | Buffer) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

function toRecord(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) return {};
  if (typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { data };
}

const ok = (text: string, data: unknown) => ({
  content: [{ type: 'text' as const, text }],
  structuredContent: toRecord(data),
});

const list = (text: string, items: unknown) => ok(text, { items });

function escapeInputText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '%s')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

type SearchCriteria = FindCriteria;

async function fetchUiXml() {
  await adbShell('uiautomator dump /sdcard/ui.xml');
  const { stdout } = await adbExecOut(['cat', '/sdcard/ui.xml']);
  return toText(stdout);
}

async function fetchUiElements() {
  const xml = await fetchUiXml();
  return parseUIElements(xml);
}

function isInteractive(element: UIElement) {
  return element.clickable || element.checkable || element.scrollable;
}

function hasValidBounds(element: UIElement) {
  const { x1, y1, x2, y2 } = element.bounds;
  return x2 > x1 && y2 > y1;
}

function isOnlyProgress(elements: UIElement[]) {
  if (elements.length === 0) return true;
  return elements.every((element) =>
    element.class.toLowerCase().includes('progressbar')
  );
}

async function fetchUiElementsWithRetry({
  onlyInteractive,
  attempts = 3,
  delayMs = 400,
}: {
  onlyInteractive?: boolean;
  attempts?: number;
  delayMs?: number;
}) {
  let lastElements: UIElement[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const elements = await fetchUiElements();
    lastElements = elements;
    const interactiveCount = elements.filter(isInteractive).length;
    const shouldRetry =
      elements.length === 0 ||
      isOnlyProgress(elements) ||
      (onlyInteractive === true && interactiveCount === 0);

    if (!shouldRetry) {
      return elements;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return lastElements;
}

function buildCriteria(criteria: SearchCriteria) {
  return criteria;
}

export function registerAndroidTools(server: McpServer) {
  const emptySchema = z.object({});

  server.registerTool(
    'devices',
    {
      title: 'List devices',
      description: 'List connected Android devices and emulators.',
      inputSchema: emptySchema,
    },
    async () => {
      const { stdout } = await adbExec(['devices', '-l']);
      const lines = toText(stdout)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const items = lines.slice(1).map((line) => {
        const [serial, state, ...rest] = line.split(/\s+/);
        return { serial, state, details: rest.join(' ') };
      });
      return list('Devices fetched.', items);
    }
  );

  server.registerTool(
    'inspect',
    {
      title: 'Inspect',
      description:
        'Capture a screenshot and parse UI hierarchy into structured elements.',
      inputSchema: z.object({
        onlyInteractive: z.boolean().optional(),
        includeScreenshot: z.boolean().optional(),
        includeElements: z.boolean().optional(),
      }),
    },
    async ({
      onlyInteractive,
      includeScreenshot,
      includeElements,
    }: {
      onlyInteractive?: boolean;
      includeScreenshot?: boolean;
      includeElements?: boolean;
    }) => {
      const shouldIncludeScreenshot = includeScreenshot ?? true;
      const shouldIncludeElements = includeElements ?? true;
      const elements = await fetchUiElementsWithRetry({
        onlyInteractive,
        attempts: 3,
        delayMs: 400,
      });
      const filtered = onlyInteractive
        ? elements.filter(isInteractive)
        : elements;
      const summary = generateSummary(filtered);
      let screenshotBase64: string | null = null;
      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      > = [{ type: 'text', text: summary }];

      if (shouldIncludeScreenshot) {
        const { stdout } = await adbExecOut(['screencap', '-p']);
        const screenshot = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(stdout);
        screenshotBase64 = screenshot.toString('base64');
        content.push({
          type: 'image',
          data: screenshotBase64,
          mimeType: 'image/png',
        });
      }

      return {
        content,
        structuredContent: toRecord({
          screenshot: screenshotBase64,
          elements: shouldIncludeElements ? filtered : [],
          summary,
        }),
      };
    }
  );

  server.registerTool(
    'findElement',
    {
      title: 'Find element',
      description: 'Find UI elements by criteria.',
      inputSchema: z.object({
        text: z.string().optional(),
        textContains: z.string().optional(),
        class: z.string().optional(),
        resourceId: z.string().optional(),
        resourceIdContains: z.string().optional(),
        contentDesc: z.string().optional(),
        contentDescContains: z.string().optional(),
        checkable: z.boolean().optional(),
        clickable: z.boolean().optional(),
        normalizeWhitespace: z.boolean().optional(),
        caseInsensitive: z.boolean().optional(),
      }),
    },
    async (criteria: SearchCriteria) => {
      const elements = await fetchUiElements();
      const matches = findElements(elements, buildCriteria(criteria));
      return ok(`Found ${matches.length} element(s).`, {
        found: matches.length > 0,
        count: matches.length,
        elements: matches,
      });
    }
  );

  server.registerTool(
    'tapElement',
    {
      title: 'Tap element',
      description: 'Find an element and tap its center coordinate.',
      inputSchema: z.object({
        text: z.string().optional(),
        textContains: z.string().optional(),
        class: z.string().optional(),
        resourceId: z.string().optional(),
        resourceIdContains: z.string().optional(),
        contentDesc: z.string().optional(),
        contentDescContains: z.string().optional(),
        index: z.number().optional(),
        preferClickable: z.boolean().optional(),
        normalizeWhitespace: z.boolean().optional(),
        caseInsensitive: z.boolean().optional(),
      }),
    },
    async ({
      text,
      textContains,
      class: className,
      resourceId,
      resourceIdContains,
      contentDesc,
      contentDescContains,
      index,
      preferClickable,
      normalizeWhitespace,
      caseInsensitive,
    }: {
      text?: string;
      textContains?: string;
      class?: string;
      resourceId?: string;
      resourceIdContains?: string;
      contentDesc?: string;
      contentDescContains?: string;
      index?: number;
      preferClickable?: boolean;
      normalizeWhitespace?: boolean;
      caseInsensitive?: boolean;
    }) => {
      const elements = await fetchUiElements();
      const matches = findElements(elements, {
        text,
        textContains,
        class: className,
        resourceId,
        resourceIdContains,
        contentDesc,
        contentDescContains,
        normalizeWhitespace,
        caseInsensitive,
      });
      if (matches.length === 0) {
        return ok('No matching elements found.', {
          tapped: false,
          element: null,
          message: 'No matching elements found.',
        });
      }

      const shouldPreferClickable = preferClickable ?? true;
      const orderedMatches =
        shouldPreferClickable && matches.some((element) => element.clickable)
          ? matches.filter((element) => element.clickable)
          : matches;
      const elementIndex = index ?? 0;
      const element = orderedMatches[elementIndex];
      if (!element) {
        return ok('Element index out of range.', {
          tapped: false,
          element: null,
          message: 'Element index out of range.',
        });
      }

      if (!hasValidBounds(element)) {
        return ok('Element bounds invalid; tap aborted.', {
          tapped: false,
          element,
          message: 'Element bounds invalid; tap aborted.',
        });
      }

      await adbShell(`input tap ${element.center.x} ${element.center.y}`);
      return ok('Element tapped.', {
        tapped: true,
        element,
        message: 'Element tapped.',
      });
    }
  );

  server.registerTool(
    'waitForElement',
    {
      title: 'Wait for element',
      description: 'Wait until an element appears or timeout is reached.',
      inputSchema: z.object({
        text: z.string().optional(),
        textContains: z.string().optional(),
        class: z.string().optional(),
        resourceId: z.string().optional(),
        resourceIdContains: z.string().optional(),
        contentDesc: z.string().optional(),
        contentDescContains: z.string().optional(),
        timeout: z.number().optional(),
        interval: z.number().optional(),
        shouldBeChecked: z.boolean().optional(),
        shouldBeEnabled: z.boolean().optional(),
        shouldBeClickable: z.boolean().optional(),
        normalizeWhitespace: z.boolean().optional(),
        caseInsensitive: z.boolean().optional(),
      }),
    },
    async ({
      text,
      textContains,
      class: className,
      resourceId,
      resourceIdContains,
      contentDesc,
      contentDescContains,
      timeout,
      interval,
      shouldBeChecked,
      shouldBeEnabled,
      shouldBeClickable,
      normalizeWhitespace,
      caseInsensitive,
    }: {
      text?: string;
      textContains?: string;
      class?: string;
      resourceId?: string;
      resourceIdContains?: string;
      contentDesc?: string;
      contentDescContains?: string;
      timeout?: number;
      interval?: number;
      shouldBeChecked?: boolean;
      shouldBeEnabled?: boolean;
      shouldBeClickable?: boolean;
      normalizeWhitespace?: boolean;
      caseInsensitive?: boolean;
    }) => {
      const timeoutMs = Math.max(0, timeout ?? 10000);
      const intervalMs = Math.max(50, interval ?? 500);
      const start = Date.now();

      const stateMatches = (element: UIElement) => {
        if (
          shouldBeChecked !== undefined &&
          element.checked !== shouldBeChecked
        ) {
          return false;
        }
        if (
          shouldBeEnabled !== undefined &&
          element.enabled !== shouldBeEnabled
        ) {
          return false;
        }
        if (
          shouldBeClickable !== undefined &&
          element.clickable !== shouldBeClickable
        ) {
          return false;
        }
        return true;
      };

      while (Date.now() - start <= timeoutMs) {
        const elements = await fetchUiElements();
        const matches = findElements(elements, {
          text,
          textContains,
          class: className,
          resourceId,
          resourceIdContains,
          contentDesc,
          contentDescContains,
          normalizeWhitespace,
          caseInsensitive,
        });
        const matched = matches.find(stateMatches);
        if (matched) {
          const elapsed = Date.now() - start;
          return ok(`Element found after ${elapsed}ms.`, {
            found: true,
            element: matched,
            elapsed,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      const elapsed = Date.now() - start;
      return ok(`Element not found after ${elapsed}ms.`, {
        found: false,
        element: null,
        elapsed,
      });
    }
  );

  server.registerTool(
    'assertElement',
    {
      title: 'Assert element',
      description: 'Assert element presence and state.',
      inputSchema: z.object({
        text: z.string().optional(),
        textContains: z.string().optional(),
        class: z.string().optional(),
        resourceId: z.string().optional(),
        resourceIdContains: z.string().optional(),
        contentDesc: z.string().optional(),
        contentDescContains: z.string().optional(),
        shouldExist: z.boolean().optional(),
        shouldBeChecked: z.boolean().optional(),
        shouldBeEnabled: z.boolean().optional(),
        shouldBeClickable: z.boolean().optional(),
        normalizeWhitespace: z.boolean().optional(),
        caseInsensitive: z.boolean().optional(),
      }),
    },
    async ({
      text,
      textContains,
      class: className,
      resourceId,
      resourceIdContains,
      contentDesc,
      contentDescContains,
      shouldExist,
      shouldBeChecked,
      shouldBeEnabled,
      shouldBeClickable,
      normalizeWhitespace,
      caseInsensitive,
    }: {
      text?: string;
      textContains?: string;
      class?: string;
      resourceId?: string;
      resourceIdContains?: string;
      contentDesc?: string;
      contentDescContains?: string;
      shouldExist?: boolean;
      shouldBeChecked?: boolean;
      shouldBeEnabled?: boolean;
      shouldBeClickable?: boolean;
      normalizeWhitespace?: boolean;
      caseInsensitive?: boolean;
    }) => {
      const elements = await fetchUiElements();
      const matches = findElements(elements, {
        text,
        textContains,
        class: className,
        resourceId,
        resourceIdContains,
        contentDesc,
        contentDescContains,
        normalizeWhitespace,
        caseInsensitive,
      });
      const expectExist = shouldExist ?? true;

      if (!expectExist) {
        if (matches.length === 0) {
          return ok('Element not found as expected.', {
            passed: true,
            message: 'Element not found as expected.',
            actual: null,
          });
        }
        return ok('Element found but should not exist.', {
          passed: false,
          message: 'Element found but should not exist.',
          actual: matches[0],
        });
      }

      if (matches.length === 0) {
        return ok('Element not found.', {
          passed: false,
          message: 'Element not found.',
          actual: null,
        });
      }

      const stateMatches = (element: UIElement) => {
        if (
          shouldBeChecked !== undefined &&
          element.checked !== shouldBeChecked
        ) {
          return false;
        }
        if (
          shouldBeEnabled !== undefined &&
          element.enabled !== shouldBeEnabled
        ) {
          return false;
        }
        if (
          shouldBeClickable !== undefined &&
          element.clickable !== shouldBeClickable
        ) {
          return false;
        }
        return true;
      };

      const matched = matches.find(stateMatches);
      if (!matched) {
        return ok('Element found but state does not match.', {
          passed: false,
          message: 'Element found but state does not match.',
          actual: matches[0],
        });
      }

      return ok('Element assertion passed.', {
        passed: true,
        message: 'Element assertion passed.',
        actual: matched,
      });
    }
  );

  server.registerTool(
    'tap',
    {
      title: 'Tap',
      description: 'Tap on screen at coordinates.',
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
      }),
    },
    async ({ x, y }: { x: number; y: number }) => {
      await adbShell(`input tap ${x} ${y}`);
      return ok(`Tapped at (${x}, ${y}).`, { x, y });
    }
  );

  server.registerTool(
    'swipe',
    {
      title: 'Swipe',
      description: 'Swipe on screen from one coordinate to another.',
      inputSchema: z.object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        duration: z.number().optional(),
      }),
    },
    async ({
      x1,
      y1,
      x2,
      y2,
      duration,
    }: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      duration?: number;
    }) => {
      const swipeDuration = duration ?? 300;
      await adbShell(`input swipe ${x1} ${y1} ${x2} ${y2} ${swipeDuration}`);
      return ok('Swipe executed.', { x1, y1, x2, y2, duration: swipeDuration });
    }
  );

  server.registerTool(
    'longPress',
    {
      title: 'Long press',
      description: 'Press and hold on screen at coordinates.',
      inputSchema: z.object({
        x: z.number(),
        y: z.number(),
        duration: z.number().optional(),
      }),
    },
    async ({ x, y, duration }: { x: number; y: number; duration?: number }) => {
      const pressDuration = duration ?? 1000;
      await adbShell(`input swipe ${x} ${y} ${x} ${y} ${pressDuration}`);
      return ok('Long press executed.', { x, y, duration: pressDuration });
    }
  );

  server.registerTool(
    'inputText',
    {
      title: 'Input text',
      description: 'Type text into the focused input field.',
      inputSchema: z.object({
        text: z.string(),
      }),
    },
    async ({ text }: { text: string }) => {
      const escaped = escapeInputText(text);
      await adbShell(`input text ${escaped}`);
      return ok('Text input sent.', { text });
    }
  );

  server.registerTool(
    'keyEvent',
    {
      title: 'Key event',
      description: 'Send an Android key event to the device.',
      inputSchema: z.object({
        keyCode: z.string(),
      }),
    },
    async ({ keyCode }: { keyCode: string }) => {
      await adbShell(`input keyevent ${keyCode}`);
      return ok(`Key event ${keyCode} sent.`, { keyCode });
    }
  );

  server.registerTool(
    'openApp',
    {
      title: 'Open app',
      description: 'Launch an Android app by package name.',
      inputSchema: z.object({
        packageName: z.string(),
      }),
    },
    async ({ packageName }: { packageName: string }) => {
      await adbShell(
        `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
      );
      return ok(`App ${packageName} launched.`, { packageName });
    }
  );

  server.registerTool(
    'listPackages',
    {
      title: 'List packages',
      description: 'List installed package names.',
      inputSchema: z.object({
        filter: z.string().optional(),
      }),
    },
    async ({ filter }: { filter?: string }) => {
      const { stdout } = await adbShell('pm list packages');
      const packages = toText(stdout)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^package:/, ''));
      const items = filter
        ? packages.filter((name) => name.includes(filter))
        : packages;
      return list('Packages fetched.', items);
    }
  );
}
