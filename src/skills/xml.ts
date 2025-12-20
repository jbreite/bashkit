import type { SkillMetadata } from "./types";

/**
 * Generates XML representation of available skills for system prompts.
 * This is the recommended format for Claude models per the Agent Skills spec.
 *
 * The output includes name, description, and location for each skill.
 * Agents can use the location path with the Read tool to activate a skill.
 *
 * @param skills - Array of skill metadata
 * @returns XML string to inject into system prompt
 *
 * @example
 * ```typescript
 * const skills = await discoverSkills();
 * const xml = skillsToXml(skills);
 * // Returns:
 * // <available_skills>
 * //   <skill>
 * //     <name>pdf-processing</name>
 * //     <description>Extract text from PDFs...</description>
 * //     <location>/path/to/.skills/pdf-processing/SKILL.md</location>
 * //   </skill>
 * // </available_skills>
 * ```
 */
export function skillsToXml(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "<available_skills>\n</available_skills>";
  }

  const skillElements = skills
    .map((skill) => {
      const name = escapeXml(skill.name);
      const description = escapeXml(skill.description);
      const location = escapeXml(skill.path);

      return `  <skill>
    <name>${name}</name>
    <description>${description}</description>
    <location>${location}</location>
  </skill>`;
    })
    .join("\n");

  return `<available_skills>\n${skillElements}\n</available_skills>`;
}

/**
 * Escapes special XML characters in a string.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
