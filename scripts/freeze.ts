import { writeSourcesLock } from "../src/corpus/assemble.js";

writeSourcesLock("fixtures/corpus", "fixtures/sources.lock.json");
console.log("wrote fixtures/sources.lock.json");
