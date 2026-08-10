export type AppView = "compact-file" | "workspace-editor" | "workspace-welcome";

export function resolveAppView(
  root: string | null,
  chromeMode: "workspace" | "compact-file",
): AppView {
  if (chromeMode === "compact-file") return "compact-file";
  return root ? "workspace-editor" : "workspace-welcome";
}
