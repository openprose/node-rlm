// S-NIAH (Single Needle in a Haystack) synthetic task generator.
// No download needed — tasks are generated programmatically.

import { randomBytes } from "node:crypto";
import type { EvalTask } from "../types.js";

/** Available context length presets (in characters). */
export const CONTEXT_LENGTHS = [
	8_000,      // 8K chars  (~2K tokens)
	16_000,     // 16K chars (~4K tokens)
	32_000,     // 32K chars (~8K tokens)
	64_000,     // 64K chars (~16K tokens)
	128_000,    // 128K chars (~32K tokens)
	256_000,    // 256K chars (~64K tokens)
] as const;

/** Topics for generating diverse filler text. */
const FILLER_TOPICS = [
	"The history of maritime navigation spans thousands of years, from early Polynesian wayfinding using stars and ocean currents to the development of the magnetic compass in medieval China.",
	"Botanical gardens serve as important centers for plant conservation, education, and scientific research, maintaining living collections of documented plants for study.",
	"The development of railroad systems in the 19th century transformed global trade and settlement patterns, connecting remote communities to urban centers.",
	"Atmospheric science studies the dynamics of Earth's atmosphere, including weather patterns, climate systems, and the chemical composition of air.",
	"The art of bookbinding dates back to the early codex format, evolving from simple stitched gatherings to elaborate decorated leather covers.",
	"Volcanic islands form through the accumulation of lava and volcanic debris above sea level, creating unique ecosystems isolated from continental landmasses.",
	"The practice of beekeeping has been documented since ancient Egypt, with honey serving as both a food source and a preservative throughout history.",
	"Mechanical clocks first appeared in European monasteries during the 13th century, driven by weights and regulated by escapement mechanisms.",
	"The study of linguistics examines the structure, use, and psychology of language, including phonetics, syntax, semantics, and pragmatics.",
	"Traditional Japanese pottery encompasses a wide range of styles, from the rustic aesthetic of Raku ware to the refined precision of Arita porcelain.",
	"The architecture of bridges reflects both engineering principles and aesthetic considerations, spanning materials from ancient stone arches to modern cable-stayed designs.",
	"Glaciology investigates the formation, movement, and effects of glaciers and ice sheets on the landscape and global climate systems.",
	"The history of cartography reflects humanity's evolving understanding of geography, from clay tablets of ancient Babylon to satellite imagery.",
	"Textile production has evolved from hand spinning and weaving to industrial manufacturing, while traditional techniques remain valued as cultural heritage.",
	"The physics of sound involves the study of mechanical waves that propagate through gases, liquids, and solids as longitudinal pressure variations.",
	"Agricultural terracing has been practiced for millennia in mountainous regions, creating flat planting surfaces on steep hillsides to prevent erosion.",
];

function generateNeedle(seed: string): { needle: string; question: string; answer: string } {
	// Generate a unique, unambiguous fact that cannot be guessed
	const id = randomBytes(4).toString("hex").toUpperCase();
	const number = Math.floor(Math.random() * 9000) + 1000;
	const colors = ["crimson", "azure", "emerald", "amber", "violet", "coral", "indigo", "scarlet"];
	const color = colors[Math.floor(Math.random() * colors.length)];
	const animals = ["falcon", "dolphin", "panther", "serpent", "phoenix", "griffin", "dragon", "mantis"];
	const animal = animals[Math.floor(Math.random() * animals.length)];

	const needle = `The secret code for Project ${id} is: ${color}-${animal}-${number}.`;
	const question = `What is the secret code for Project ${id}?`;
	const answer = `${color}-${animal}-${number}`;

	return { needle, question, answer };
}

function generateHaystack(charCount: number, seed: number): string {
	const paragraphs: string[] = [];
	let currentLength = 0;

	// Use a deterministic-ish sequence based on seed
	let topicIndex = seed % FILLER_TOPICS.length;

	while (currentLength < charCount) {
		// Pick a topic and expand it into a paragraph
		const base = FILLER_TOPICS[topicIndex % FILLER_TOPICS.length];
		// Create variation by repeating and rephrasing
		const paragraph = expandParagraph(base, topicIndex);
		paragraphs.push(paragraph);
		currentLength += paragraph.length + 2; // +2 for \n\n
		topicIndex++;
	}

	return paragraphs.join("\n\n").slice(0, charCount);
}

function expandParagraph(base: string, variation: number): string {
	const extensions = [
		"This field of study continues to evolve as new discoveries are made and technologies advance.",
		"Researchers have documented extensive findings that contribute to our understanding of the subject.",
		"The practical applications of this knowledge extend across multiple disciplines and industries.",
		"Historical records provide valuable context for understanding how these practices developed over time.",
		"Modern techniques have significantly improved our ability to study and apply these principles.",
		"The intersection of traditional knowledge and contemporary science offers promising avenues for future research.",
		"Educational institutions around the world dedicate significant resources to advancing this area of study.",
		"International collaboration has accelerated progress and enabled sharing of insights across cultural boundaries.",
	];

	const ext1 = extensions[variation % extensions.length];
	const ext2 = extensions[(variation + 3) % extensions.length];
	const ext3 = extensions[(variation + 5) % extensions.length];

	return `${base} ${ext1} ${ext2} ${ext3}`;
}

export async function generateSNIAHTasks(
	tasksPerLength = 8,
	lengths: readonly number[] = CONTEXT_LENGTHS,
): Promise<EvalTask[]> {
	const tasks: EvalTask[] = [];
	let taskIndex = 0;

	for (const contextLen of lengths) {
		for (let i = 0; i < tasksPerLength; i++) {
			const seed = `sniah-${contextLen}-${i}`;
			const { needle, question, answer } = generateNeedle(seed);

			// Generate haystack text
			const haystackLen = contextLen - needle.length - 100; // Leave room for needle + buffer
			const haystack = generateHaystack(Math.max(haystackLen, 1000), taskIndex);

			// Insert needle at a random position (by paragraph boundary)
			const paragraphs = haystack.split("\n\n");
			const insertIndex = Math.floor(Math.random() * paragraphs.length);
			paragraphs.splice(insertIndex, 0, needle);
			const context = paragraphs.join("\n\n");

			// Calculate needle position as a fraction of total context
			const needlePosition = context.indexOf(needle) / context.length;

			tasks.push({
				id: `sniah-${contextLen}-${i}`,
				query: `${question} The answer is in the \`context\` variable. Search through it to find and return the answer.`,
				context,
				expected: answer,
				metadata: {
					contextLenTarget: contextLen,
					contextLenActual: context.length,
					needlePosition: Math.round(needlePosition * 100) / 100,
				},
			});

			taskIndex++;
		}
	}

	return tasks;
}
