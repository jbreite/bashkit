import { fetchSkill } from "../src/skills/fetch";

console.log("Testing fetchSkill (full folder)...\n");

try {
  const pdfSkill = await fetchSkill("anthropics/skills/pdf");

  console.log("✓ Fetched pdf skill");
  console.log("  Name:", pdfSkill.name);
  console.log("  Files:", Object.keys(pdfSkill.files).length);
  console.log("\n  File listing:");
  for (const [path, content] of Object.entries(pdfSkill.files)) {
    console.log(`    - ${path} (${content.length} chars)`);
  }

  console.log("\n  SKILL.md preview:");
  console.log(pdfSkill.files["SKILL.md"]?.slice(0, 400));
} catch (e) {
  console.error("✗ Failed:", (e as Error).message);
}
