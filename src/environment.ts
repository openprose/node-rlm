import vm from "node:vm";
import * as acorn from "acorn";

export interface RlmEnvironment {
	exec(code: string): Promise<{ output: string; error: string | null; returnValue?: unknown }>;
	get(name: string): unknown;
	set(name: string, value: unknown): void;
}

export class JsEnvironment implements RlmEnvironment {
	private context: vm.Context;
	private maxOutput: number;

	// Per-exec output buffer; swapped in exec() for isolation.
	private activeOutput: string[] = [];

	private declaredNames = new Set<string>();

	constructor(maxOutput = 50 * 1024) {
		this.maxOutput = maxOutput;
		const capture = (...args: unknown[]) => {
			this.activeOutput.push(args.map(String).join(" "));
		};

		const sandbox: Record<string, unknown> = {
			console: { log: capture, error: capture, warn: capture, info: capture },
			require: (id: string) => {
				const moduleId = id.startsWith("node:") ? id : `node:${id}`;
				try {
					return require(moduleId);
				} catch {
					throw new Error(`Cannot require '${id}'. Only Node.js built-in modules are available.`);
				}
			},
			setTimeout,
			setInterval,
			clearTimeout,
			clearInterval,
			URL,
			URLSearchParams,
			TextEncoder,
			TextDecoder,
		};

		this.context = vm.createContext(sandbox);
	}

	async exec(code: string): Promise<{ output: string; error: string | null; returnValue?: unknown }> {
		// Each exec gets its own output buffer. Save/restore ensures
		// nested exec calls (e.g. child rlm inside parent exec) don't
		// clobber the parent's output.
		const myOutput: string[] = [];
		const previousOutput = this.activeOutput;
		this.activeOutput = myOutput;

		const strayErrors: string[] = [];
		const handler = (reason: unknown) => {
			strayErrors.push(reason instanceof Error ? reason.message : String(reason));
		};
		process.on("unhandledRejection", handler);

		try {
			const { declarations, body } = this.hoistDeclarations(code);

			if (declarations) {
				new vm.Script(declarations).runInContext(this.context);
			}

			const wrapped = `(async () => {\n${body}\n})()`;
			const script = new vm.Script(wrapped, { filename: "<repl>" });
			const result = await script.runInContext(this.context, { timeout: 30_000 });
			await new Promise((r) => setTimeout(r, 0));
			const error = strayErrors.length > 0 ? strayErrors.join("; ") : null;
			return {
				output: this.truncate(myOutput.join("\n")),
				error,
				returnValue: result,
			};
		} catch (err: unknown) {
			const output = this.truncate(myOutput.join("\n"));
			const error = err instanceof Error ? err.message : String(err);
			return { output, error };
		} finally {
			this.activeOutput = previousOutput;
			process.removeListener("unhandledRejection", handler);
		}
	}

	get(name: string): unknown {
		return this.context[name];
	}

	set(name: string, value: unknown): void {
		this.context[name] = value;
	}

	private hoistDeclarations(code: string): { declarations: string; body: string } {
		let program: acorn.Program;
		try {
			program = acorn.parse(code, {
				ecmaVersion: "latest",
				sourceType: "script",
				allowAwaitOutsideFunction: true,
			});
		} catch {
			return { declarations: "", body: code };
		}

		const newDecls: string[] = [];
		const declare = (name: string) => {
			if (!this.declaredNames.has(name)) {
				this.declaredNames.add(name);
				newDecls.push(`let ${name};`);
			}
		};

		const segments: string[] = [];
		let cursor = 0;

		for (const node of program.body) {
			if (node.type === "VariableDeclaration") {
				segments.push(code.slice(cursor, node.start));

				const assignments: string[] = [];
				for (const decl of node.declarations) {
					for (const name of this.extractBindingNames(decl.id as acorn.Pattern)) {
						declare(name);
					}
					if (!decl.init) continue;

					const pattern = code.slice(decl.id.start, decl.id.end);
					const init = code.slice(decl.init.start, decl.init.end);
					const needsParens = decl.id.type !== "Identifier";
					assignments.push(needsParens ? `(${pattern} = ${init})` : `${pattern} = ${init}`);
				}

				if (assignments.length > 0) {
					segments.push(`${assignments.join("; ")};`);
				}
				cursor = node.end;
			} else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
				const name = node.id.name;
				declare(name);
				segments.push(code.slice(cursor, node.start));
				segments.push(`${name} = ${code.slice(node.start, node.end)}`);
				cursor = node.end;
			} else if (
				node.type === "ExpressionStatement" &&
				(node as any).expression.type === "CallExpression"
			) {
				// Auto-await top-level function calls to prevent unawaited async calls.
				// This is safe because: (1) code runs inside an async wrapper, and
				// (2) `await nonPromise` is a no-op in JavaScript.
				const expr = (node as any).expression;
				segments.push(code.slice(cursor, expr.start));
				segments.push(`await ${code.slice(expr.start, node.end)}`);
				cursor = node.end;
			}
		}

		segments.push(code.slice(cursor));

		return {
			declarations: newDecls.join("\n"),
			body: segments.join(""),
		};
	}

	private extractBindingNames(pattern: acorn.Pattern): string[] {
		switch (pattern.type) {
			case "Identifier":
				return [pattern.name];
			case "ObjectPattern":
				return pattern.properties.flatMap((prop) =>
					this.extractBindingNames(prop.type === "RestElement" ? prop.argument : (prop.value as acorn.Pattern)),
				);
			case "ArrayPattern":
				return pattern.elements.flatMap((el) => (el ? this.extractBindingNames(el) : []));
			case "RestElement":
				return this.extractBindingNames(pattern.argument);
			case "AssignmentPattern":
				return this.extractBindingNames(pattern.left);
			default:
				return [];
		}
	}

	private truncate(text: string): string {
		if (text.length <= this.maxOutput) return text;
		const half = Math.floor(this.maxOutput / 2);
		return `${text.slice(0, half)}\n\n... [truncated ${text.length - this.maxOutput} chars] ...\n\n${text.slice(-half)}`;
	}
}
