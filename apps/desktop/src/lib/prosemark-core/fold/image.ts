import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import { normalizeMarkdownDestination } from "@/lib/paths";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
import { iterChildren } from "../utils";

// Last measured widget height per markdown destination. Images decode async,
// so without a remembered height every scroll past an unloaded image inserts
// a ~1-line placeholder that later snaps to natural size and shifts the
// heightmap under the viewport (the "jumpy scroll"). The cache survives
// widget rebuilds and re-opens of the same document.
const imageHeightCache = new Map<string, number>();

class ImageWidget extends WidgetType {
  constructor(
    public url: string,
    public block?: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return this.url === other.url && this.block === other.block;
  }

  get estimatedHeight(): number {
    return imageHeightCache.get(this.url) ?? -1;
  }

  toDOM(view: EditorView) {
    const elem = document.createElement(this.block ? "div" : "span");
    elem.className = "cm-image";
    if (this.block) {
      elem.className += " cm-image-block";
    }
    const image = document.createElement("img");
    const cached = imageHeightCache.get(this.url);
    if (cached !== undefined) {
      // Reserve the last known height until this instance finishes decoding,
      // so re-entering the viewport doesn't collapse-then-grow the block.
      image.style.height = `${cached}px`;
    }
    // The src resolver plugin may rewrite `src` after insertion, so `load`
    // can fire more than once; the last one wins.
    image.addEventListener("load", () => {
      image.style.height = "";
      const height = elem.getBoundingClientRect().height;
      if (height > 0) {
        imageHeightCache.set(this.url, height);
      }
      view.requestMeasure();
    });
    image.addEventListener("error", () => {
      image.style.height = "";
      view.requestMeasure();
    });
    image.src = this.url;
    elem.appendChild(image);
    return elem;
  }

  // allows clicks to pass through to the editor
  ignoreEvent(_event: Event) {
    return false;
  }
}

export const imageExtension = [
  foldableSyntaxFacet.of({
    nodePath: "Image",
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node, selectionTouchesRange) => {
      let imageUrl: string | undefined;
      iterChildren(node.node.cursor(), (node) => {
        if (node.name === "URL") {
          imageUrl = normalizeMarkdownDestination(state.doc.sliceString(node.from, node.to));
        }

        return undefined;
      });

      if (imageUrl) {
        const line = state.doc.lineAt(node.from);
        const block = node.from == line.from && node.to == line.to;
        const widget = new ImageWidget(imageUrl, block);

        if (selectionTouchesRange) {
          return Decoration.widget({
            widget,
            block,
          }).range(node.to, node.to);
        } else {
          return Decoration.replace({
            widget,
            block,
          }).range(node.from, node.to);
        }
      }
    },
  }),
  selectAllDecorationsOnSelectExtension("cm-image"),
];

export const __testImage = {
  imageHeightCache,
};
