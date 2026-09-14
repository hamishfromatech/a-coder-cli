import { pageItems } from "./lib/pager.js";

const alphabet = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

console.log("page 1:", JSON.stringify(pageItems(alphabet, 1, 5)));
console.log("page 2:", JSON.stringify(pageItems(alphabet, 2, 5)));
console.log("page 3:", JSON.stringify(pageItems(alphabet, 3, 5)));
console.log("page 4:", JSON.stringify(pageItems(alphabet, 4, 5)));