import { createCustomLogger } from "../src/index.ts";

const log = createCustomLogger({ consoleLevel: "DEBUG" }, true);

const section = (title: string) => {
  const bar = "-".repeat(40);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
};

const info = (msg: string, arg: unknown) => {
  console.log(msg, arg);
  log.info(msg, arg);
  //logNew.info(msg, arg);
};

const error = (msg: string, arg?: unknown) => {
  console.error(msg, arg);
  log.error(msg, arg);
  //logNew.error(msg, arg);
};

// Primitives
section("Primitives");
info("string", "hello world");
info("number", 42);
info("boolean", true);
info("null", null);
info("undefined", undefined);

// Simple object
section("Simple Object");
info("object", { name: "Alice", age: 30, active: true });

// Nested object
section("Nested Object");
const nested = {
  user: { name: "Bob", address: { city: "Seattle", zip: "98101" } },
  tags: ["admin", "user"],
};
info("nested", nested);

// Deep object (truncation test)
section("Deep Object (truncation)");
const deep = {
  level1: { level2: { level3: { level4: { deepValue: "buried" } } } },
};
info("deep", deep);

// Arrays
section("Simple Array");
info("array", [1, 2, 3, 4, 5]);

section("Array of Objects");
const people = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Carol", age: 35 },
];
info("people", people);

section("Long Array (truncation)");
const long = Array.from({ length: 25 }, (_, i) => i);
info("long", long);

// Date
section("Date");
info("date", new Date("2024-06-15T12:30:00Z"));

// Error
section("Error");
info("error", new Error("something went wrong"));

// Mixed / realistic payload
section("Realistic Log Payload");
const payload = {
  requestId: "abc-123",
  user: { id: 42, role: "admin" },
  duration: 238,
  status: 200,
};
info("payload", payload);

// Error comparisons
section("error: string message");
error("something went wrong");

section("error: Error object");
error("error", new Error("database connection failed"));

section("error: object with details");
const errDetails = { code: 500, message: "internal error", path: "/api/users" };
error("error details", errDetails);

section("error: nested context");
const errContext = {
  requestId: "xyz-789",
  error: { code: "TIMEOUT", retries: 3 },
  user: { id: 99 },
};
error("error context", errContext);
