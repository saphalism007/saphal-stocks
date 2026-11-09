export const join = (...p: string[]) => p.join("/").replace(/\/+/g, "/");
export const dirname = (p: string) => p.split("/").slice(0, -1).join("/") || "/";
export default { join, dirname };
