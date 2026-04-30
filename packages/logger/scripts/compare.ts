import { createCustomLogger } from "../src/index.ts";

const log = createCustomLogger({ consoleLevel: "debug" }, true);

const section = (title: string) => {
  const bar = "-".repeat(40);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
  log.info(`--- ${title} ---`);
};

// Primitives
section("Primitives");
console.log("string:", "hello world");
log.info("string", "hello world");

console.log("number:", 42);
log.info("number", 42);

console.log("boolean:", true);
log.info("boolean", true);

console.log("null:", null);
log.info("null", null);

console.log("undefined:", undefined);
log.info("undefined", undefined);

// Simple object
section("Simple Object");
const obj = { name: "Alice", age: 30, active: true };
console.log("object:", obj);
log.info("object", obj);

// Nested object
section("Nested Object");
const nested = {
  user: { name: "Bob", address: { city: "Seattle", zip: "98101" } },
  tags: ["admin", "user"],
};
console.log("nested:", nested);
log.info("nested", nested);

// Deep object (truncation test)
section("Deep Object (truncation)");
const deep = {
  level1: { level2: { level3: { level4: { deepValue: "buried" } } } },
};
console.log("deep:", deep);
log.info("deep", deep);

// Arrays
section("Simple Array");
const arr = [1, 2, 3, 4, 5];
console.log("array:", arr);
log.info("array", arr);

section("Array of Objects");
const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Carol", age: 35 },
];
console.log("people:", people);
log.info("people", people);

section("Long Array (truncation)");
const long = Array.from({ length: 25 }, (_, i) => i);
console.log("long:", long);
log.info("long", long);

// Date
section("Date");
const date = new Date("2024-06-15T12:30:00Z");
console.log("date:", date);
log.info("date", date);

// Error
section("Error");
const err = new Error("something went wrong");
console.log("error:", err);
log.info("error", err);

// Mixed / realistic payload
section("Realistic Log Payload");
const payload = {
  requestId: "abc-123",
  user: { id: 42, role: "admin" },
  duration: 238,
  status: 200,
};
console.log("payload:", payload);
log.info("payload", payload);
