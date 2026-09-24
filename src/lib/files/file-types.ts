// Shared by server and browser code, so no Node imports here.

export function extensionOf(name: string) {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "csv", "tsv", "json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "log", "env.example",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "ipynb", "java", "kt", "cs", "go", "rs", "rb", "php",
  "c", "h", "cpp", "hpp", "swift", "sql", "sh", "css", "scss", "html", "vue", "svelte", "astro", "dart", "r",
  "prisma", "graphql", "gql", "tf", "lua",
]);
