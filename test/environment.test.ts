import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { JsEnvironment, SANDBOX_BUILTINS } from "../src/environment.js";

describe("JsEnvironment", () => {
	it("exec: console.log", async () => {
		const env = new JsEnvironment();
		const result = await env.exec("console.log(1 + 1)");
		expect(result.output).toBe("2");
	});

	it("bare assignment persists", async () => {
		const env = new JsEnvironment();
		await env.exec("x = 42");
		const result = await env.exec("console.log(x)");
		expect(result.output).toBe("42");
	});

	it("let/const/var persist", async () => {
		const env = new JsEnvironment();
		await env.exec("let x = 42");
		const result = await env.exec("console.log(x)");
		expect(result.output).toBe("42");
	});

	it("top-level await works", async () => {
		const env = new JsEnvironment();
		const result = await env.exec("const r = await Promise.resolve(42); console.log(r)");
		expect(result.output).toBe("42");
	});

	it("thrown error captured", async () => {
		const env = new JsEnvironment();
		const result = await env.exec('throw new Error("boom")');
		expect(result.output).toBe("");
		expect(result.error).toContain("boom");
	});

	it("recovery after error", async () => {
		const env = new JsEnvironment();
		await env.exec('throw new Error("first error")');
		const result = await env.exec('console.log("still alive")');
		expect(result.error).toBeNull();
		expect(result.output).toBe("still alive");
	});

	it("get/set", async () => {
		const env = new JsEnvironment();
		env.set("myVar", 123);
		expect(env.get("myVar")).toBe(123);
	});

	it("set visible in exec", async () => {
		const env = new JsEnvironment();
		env.set("data", "hello");
		const result = await env.exec("console.log(data)");
		expect(result.output).toBe("hello");
	});

	it("console methods: all captured", async () => {
		const env = new JsEnvironment();
		const result = await env.exec(
			'console.log("LOG"); console.error("ERR"); console.warn("WARN"); console.info("INFO")',
		);
		expect(result.output).toBe("LOG\nERR\nWARN\nINFO");
	});

	it("require: node built-ins", async () => {
		const env = new JsEnvironment();
		const result = await env.exec('const path = require("path"); console.log(path.join("a", "b"))');
		expect(result.output).toBe(join("a", "b"));
	});

	it("require: rejects non-builtins", async () => {
		const env = new JsEnvironment();
		const result = await env.exec('require("express")');
		expect(result.error).toContain("Only Node.js");
	});

	it("output truncation", async () => {
		const env = new JsEnvironment(100);
		const result = await env.exec('for (let i = 0; i < 200; i++) { console.log("line " + i); }');
		expect(result.output).toContain("truncated");
		expect(result.output.length).toBeLessThan(1000);
	});

	it("buffer cleared between execs", async () => {
		const env = new JsEnvironment();
		await env.exec('console.log("first")');
		const result = await env.exec('console.log("second")');
		expect(result.output).toBe("second");
		expect(result.output).not.toContain("first");
	});

	it("multiple logs newline-separated", async () => {
		const env = new JsEnvironment();
		const result = await env.exec('console.log("a"); console.log("b")');
		expect(result.output).toBe("a\nb");
	});

	it("const persists", async () => {
		const env = new JsEnvironment();
		await env.exec("const y = 'hello'");
		const result = await env.exec("console.log(y)");
		expect(result.output).toBe("hello");
	});

	it("let re-declaration", async () => {
		const env = new JsEnvironment();
		await env.exec("let x = 1");
		await env.exec("let x = 2");
		const result = await env.exec("console.log(x)");
		expect(result.output).toBe("2");
	});

	it("const re-declaration", async () => {
		const env = new JsEnvironment();
		await env.exec("const x = 'first'");
		await env.exec("const x = 'second'");
		const result = await env.exec("console.log(x)");
		expect(result.output).toBe("second");
	});

	it("await declaration persists", async () => {
		const env = new JsEnvironment();
		await env.exec("let r = await Promise.resolve(99)");
		const result = await env.exec("console.log(r)");
		expect(result.output).toBe("99");
	});

	it("object destructuring persists", async () => {
		const env = new JsEnvironment();
		await env.exec('const { join } = require("path")');
		const result = await env.exec("console.log(typeof join)");
		expect(result.output).toBe("function");
	});

	it("array destructuring persists", async () => {
		const env = new JsEnvironment();
		await env.exec("const [a, b] = [10, 20]");
		const result = await env.exec("console.log(a, b)");
		expect(result.output).toBe("10 20");
	});

	it("function declaration persists", async () => {
		const env = new JsEnvironment();
		await env.exec("function add(a, b) { return a + b }");
		const result = await env.exec("console.log(add(2, 3))");
		expect(result.output).toBe("5");
	});

	it("class declaration persists", async () => {
		const env = new JsEnvironment();
		await env.exec("class Foo { greet() { return 'hi' } }");
		const result = await env.exec("console.log(new Foo().greet())");
		expect(result.output).toBe("hi");
	});

	it("nested let stays scoped", async () => {
		const env = new JsEnvironment();
		await env.exec("for (let i = 0; i < 3; i++) {}");
		const result = await env.exec("try { console.log(i) } catch(e) { console.log('not defined') }");
		expect(result.output).toBe("not defined");
	});

	it("if-block let stays scoped", async () => {
		const env = new JsEnvironment();
		await env.exec("if (true) { let inner = 1 }");
		const result = await env.exec("try { console.log(inner) } catch(e) { console.log('not defined') }");
		expect(result.output).toBe("not defined");
	});

	it("error preserves prior declarations", async () => {
		const env = new JsEnvironment();
		await env.exec("let safe = 'ok'");
		await env.exec("throw new Error('boom')");
		const result = await env.exec("console.log(safe)");
		expect(result.output).toBe("ok");
		expect(result.error).toBeNull();
	});

	it("parse error", async () => {
		const env = new JsEnvironment();
		const result = await env.exec("let = = =");
		expect(result.error).toBeTruthy();
	});

	it("nested exec: child output isolated", async () => {
		const env = new JsEnvironment();
		env.set("childExec", async () => {
			const result = await env.exec('console.log("child output")');
			return result.output;
		});
		const result = await env.exec(
			'console.log("parent before"); const r = await childExec(); console.log("parent after")',
		);
		expect(result.output).toBe("parent before\nparent after");
	});

	it("nested exec: child owns its output", async () => {
		const env = new JsEnvironment();
		let childResult: Awaited<ReturnType<typeof env.exec>> | undefined;
		env.set("childExec", async () => {
			childResult = await env.exec('console.log("only child")');
		});
		await env.exec('console.log("parent"); await childExec()');
		expect(childResult).toBeDefined();
		expect(childResult!.output).toBe("only child");
		expect(childResult!.output).not.toContain("parent");
	});

	it("nested exec: three levels", async () => {
		const env = new JsEnvironment();
		const results: string[] = [];
		env.set("level2", async () => {
			const r = await env.exec('console.log("L2")');
			results.push(`L2: ${r.output}`);
		});
		env.set("level1", async () => {
			const r = await env.exec('console.log("L1"); await level2()');
			results.push(`L1: ${r.output}`);
		});
		const top = await env.exec('console.log("L0"); await level1()');
		results.push(`L0: ${top.output}`);
		expect(results).toContain("L0: L0");
		expect(results).toContain("L1: L1");
		expect(results).toContain("L2: L2");
	});

	describe("snapshot", () => {
		it("returns user variables", async () => {
			const env = new JsEnvironment();
			env.set("x", 42);
			await env.exec("y = 'hello'");
			const snap = env.snapshot(SANDBOX_BUILTINS);
			expect(snap.x).toBe(42);
			expect(snap.y).toBe("hello");
		});

		it("excludes specified keys", () => {
			const env = new JsEnvironment();
			env.set("x", 10);
			env.set("y", 20);
			const snap = env.snapshot(new Set(["x"]));
			expect(snap.x).toBeUndefined();
			expect(snap.y).toBe(20);
		});

		it("skips functions", () => {
			const env = new JsEnvironment();
			env.set("fn", () => {});
			env.set("val", 99);
			const snap = env.snapshot();
			expect(snap.fn).toBeUndefined();
			expect(snap.val).toBe(99);
		});

		it("non-serializable values", () => {
			const env = new JsEnvironment();
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			env.set("circular", circular);
			const snap = env.snapshot();
			expect(snap.circular).toBe("[non-serializable]");
		});

		it("respects size limit", () => {
			const env = new JsEnvironment();
			env.set("big", Array.from({ length: 1000 }, (_, i) => i));
			const snap = env.snapshot(undefined, 100);
			const values = Object.values(snap);
			const hasTruncated = values.some(
				(v) => typeof v === "string" && v.startsWith("[truncated:"),
			);
			expect(hasTruncated).toBe(true);
		});

		it("deep-copies values", () => {
			const env = new JsEnvironment();
			const obj = { a: 1 };
			env.set("obj", obj);
			const snap = env.snapshot();
			obj.a = 999;
			expect(snap.obj).toEqual({ a: 1 });
		});
	});
});
