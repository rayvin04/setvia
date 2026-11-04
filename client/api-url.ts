const apiOrigin = ((import.meta as ImportMeta & {
  env?: ImportMetaEnv & { VITE_SETVIA_API_ORIGIN?: string };
}).env?.VITE_SETVIA_API_ORIGIN ?? "").replace(/\/$/, "");

export function apiEndpoint(path: string): string {
  return `${apiOrigin}/api${path.startsWith("/") ? path : `/${path}`}`;
}
