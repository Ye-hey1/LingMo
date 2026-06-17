import { ExcalidrawElementBase } from "./elements/ExcalidrawElement";

// Tiny chroma-js replacement: converts any CSS color string to rgba(r,g,b,a).
// Uses the browser's own color parser via a throwaway canvas — works for
// hex (#rgb / #rrggbb / #rrggbbaa), named colors, rgb(), rgba(), hsl(), etc.
// Returns the original color if we can't parse (fail-safe for odd inputs).
function parseColor(color: string): [number, number, number, number] | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    // fillStyle normalisation: if unparseable, browser keeps #000.
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3] / 255];
  } catch {
    return null;
  }
}

export function hexWithAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const [r, g, b] = parsed;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r},${g},${b},${a})`;
}

export function has(el: Element, attr: string): boolean {
  return el.hasAttribute(attr);
}

export function get(el: Element, attr: string, backup?: string): string {
  return el.getAttribute(attr) || backup || "";
}

export function getNum(el: Element, attr: string, backup?: number): number {
  const numVal = Number(get(el, attr));
  return Number.isNaN(numVal) ? backup || 0 : numVal;
}

const presAttrs = {
  stroke: "stroke",
  "stroke-opacity": "stroke-opacity",
  "stroke-width": "stroke-width",
  fill: "fill",
  "fill-opacity": "fill-opacity",
  opacity: "opacity",
} as const;

type ExPartialElement = Partial<ExcalidrawElementBase>;

type AttrHandlerArgs = {
  el: Element;
  exVals: ExPartialElement;
};

type PresAttrHandlers = {
  [key in keyof typeof presAttrs]: (args: AttrHandlerArgs) => void;
};

const attrHandlers: PresAttrHandlers = {
  stroke: ({ el, exVals }) => {
    const strokeColor = get(el, "stroke");

    exVals.strokeColor = has(el, "stroke-opacity")
      ? hexWithAlpha(strokeColor, getNum(el, "stroke-opacity"))
      : strokeColor;
  },

  "stroke-opacity": ({ el, exVals }) => {
    exVals.strokeColor = hexWithAlpha(
      get(el, "stroke", "#000000"),
      getNum(el, "stroke-opacity"),
    );
  },

  "stroke-width": ({ el, exVals }) => {
    exVals.strokeWidth = getNum(el, "stroke-width");
  },

  fill: ({ el, exVals }) => {
    const fill = get(el, `fill`);

    exVals.backgroundColor = fill === "none" ? "#00000000" : fill;
  },

  "fill-opacity": ({ el, exVals }) => {
    exVals.backgroundColor = hexWithAlpha(
      get(el, "fill", "#000000"),
      getNum(el, "fill-opacity"),
    );
  },

  opacity: ({ el, exVals }) => {
    exVals.opacity = getNum(el, "opacity", 100);
  },
};

// Presentation Attributes for SVG Elements:
// https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/Presentation
export function presAttrsToElementValues(
  el: Element,
): Partial<ExcalidrawElementBase> {
  const exVals = [...el.attributes].reduce((exVals, attr) => {
    const name = attr.name;

    if (Object.keys(attrHandlers).includes(name)) {
      attrHandlers[name as keyof PresAttrHandlers]({ el, exVals });
    }

    return exVals;
  }, {} as ExPartialElement);

  return exVals;
}

type FilterAttrs = Partial<
  Pick<ExcalidrawElementBase, "x" | "y" | "width" | "height">
>;

export function filterAttrsToElementValues(el: Element): FilterAttrs {
  const filterVals: FilterAttrs = {};

  if (has(el, "x")) {
    filterVals.x = getNum(el, "x");
  }

  if (has(el, "y")) {
    filterVals.y = getNum(el, "y");
  }

  if (has(el, "width")) {
    filterVals.width = getNum(el, "width");
  }

  if (has(el, "height")) {
    filterVals.height = getNum(el, "height");
  }

  return filterVals;
}

export function pointsAttrToPoints(el: Element): number[][] {
  let points: number[][] = [];

  if (has(el, "points")) {
    points = get(el, "points")
      .split(" ")
      .map((p) => p.split(",").map(parseFloat));
  }

  return points;
}
