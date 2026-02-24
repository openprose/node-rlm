import type { RlmEvent, RlmEventSink } from "./events.js";

export interface EventFilter {
	runId?: string;
	invocationId?: string;
	type?: RlmEvent["type"] | RlmEvent["type"][];
}

export interface TreeNode {
	invocationId: string;
	children: TreeNode[];
}

type EventHandler<T extends RlmEvent> = (event: T) => void;

export class RlmObserver implements RlmEventSink {
	private events: RlmEvent[] = [];
	private handlers = new Map<string, EventHandler<never>[]>();

	emit(event: RlmEvent): void {
		this.events.push(event);
		const handlers = this.handlers.get(event.type);
		if (handlers) {
			for (const handler of handlers) {
				(handler as EventHandler<typeof event>)(event);
			}
		}
	}

	on<T extends RlmEvent["type"]>(
		type: T,
		handler: (event: Extract<RlmEvent, { type: T }>) => void,
	): void {
		let list = this.handlers.get(type);
		if (!list) {
			list = [];
			this.handlers.set(type, list);
		}
		list.push(handler as EventHandler<never>);
	}

	getEvents(filter?: EventFilter): RlmEvent[] {
		if (!filter) return [...this.events];

		const types = filter.type
			? Array.isArray(filter.type) ? new Set(filter.type) : new Set([filter.type])
			: null;

		return this.events.filter((e) => {
			if (filter.runId && e.runId !== filter.runId) return false;
			if (filter.invocationId && e.invocationId !== filter.invocationId) return false;
			if (types && !types.has(e.type)) return false;
			return true;
		});
	}

	getTree(runId: string): TreeNode | null {
		const nodes = new Map<string, TreeNode>();
		const childOf = new Map<string, string>(); // childId -> parentInvocationId

		for (const event of this.events) {
			if (event.runId !== runId) continue;

			if (event.type === "invocation:start") {
				if (!nodes.has(event.invocationId)) {
					nodes.set(event.invocationId, { invocationId: event.invocationId, children: [] });
				}
			}

			if (event.type === "delegation:spawn") {
				childOf.set(event.childId, event.invocationId);
				if (!nodes.has(event.childId)) {
					nodes.set(event.childId, { invocationId: event.childId, children: [] });
				}
			}
		}

		// Wire parent-child relationships
		for (const [childId, parentId] of childOf) {
			const parent = nodes.get(parentId);
			const child = nodes.get(childId);
			if (parent && child) {
				parent.children.push(child);
			}
		}

		// Root is the node with no parent
		for (const [id, node] of nodes) {
			if (!childOf.has(id)) return node;
		}

		return null;
	}
}
