// citation-js ships no type declarations; declare the minimal surface we use.
declare module "citation-js" {
  export default class Cite {
    constructor(data?: unknown, options?: unknown);
    data: unknown[];
  }
}
