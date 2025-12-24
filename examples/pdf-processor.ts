/**
 * PDF Processor Example
 *
 * Demonstrates using the Agent Skills standard to fetch Anthropic's PDF skill
 * and set up an agent that can process PDF documents.
 *
 * Usage:
 *   bun run examples/pdf-processor.ts <path-to-pdf>
 *
 * Example:
 *   bun run examples/pdf-processor.ts ~/Documents/invoice.pdf
 *
 * Requires: ANTHROPIC_API_KEY in environment or .env file
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, wrapLanguageModel } from "ai";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  anthropicPromptCacheMiddleware,
  createAgentTools,
  createLocalSandbox,
  fetchSkill,
  setupAgentEnvironment,
  skillsToXml,
} from "../src";

async function main() {
  // Parse CLI arguments
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error("Usage: bun run examples/pdf-processor.ts <path-to-pdf>");
    console.error("");
    console.error("Example:");
    console.error(
      "  bun run examples/pdf-processor.ts ~/Documents/invoice.pdf",
    );
    process.exit(1);
  }

  const resolvedPath = resolve(pdfPath);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  if (!resolvedPath.toLowerCase().endsWith(".pdf")) {
    console.error(`Error: File must be a PDF: ${resolvedPath}`);
    process.exit(1);
  }

  const pdfFilename = basename(resolvedPath);
  console.log("🚀 PDF Processor Agent\n");
  console.log("=".repeat(60));
  console.log(`\n📄 Input PDF: ${pdfFilename}`);

  // 1. Fetch the PDF skill from Anthropic's skills repo
  console.log("\n📥 Fetching PDF skill from GitHub...");
  const pdfSkill = await fetchSkill("anthropics/skills/pdf");
  console.log(`   ✓ Fetched ${Object.keys(pdfSkill.files).length} files:`);
  for (const path of Object.keys(pdfSkill.files)) {
    console.log(`     - ${path}`);
  }

  // 2. Create sandbox
  const workspacePath = "/tmp/bashkit-pdf";
  const sandbox = createLocalSandbox({ cwd: workspacePath });

  // 3. Set up the environment with the PDF skill
  console.log("\n📁 Setting up agent environment...");
  const config = {
    workspace: {
      input: "input/",
      output: "output/",
    },
    skills: {
      pdf: pdfSkill,
    },
  };

  const { skills } = await setupAgentEnvironment(sandbox, config);
  console.log(`   ✓ Created workspace directories`);
  console.log(`   ✓ Seeded ${skills.length} skill(s)`);

  // 4. Copy the input PDF to the workspace
  const inputDir = `${workspacePath}/input`;
  mkdirSync(inputDir, { recursive: true });
  const targetPdfPath = `${inputDir}/${pdfFilename}`;
  copyFileSync(resolvedPath, targetPdfPath);
  console.log(`   ✓ Copied PDF to input/${pdfFilename}`);

  // 5. Create tools
  const { tools } = createAgentTools(sandbox);

  // 6. Build system prompt with skills
  const systemPrompt = `You are a PDF processing assistant with access to powerful PDF manipulation tools.

**WORKSPACE:**
- Input files: ${config.workspace.input}
- Output files: ${config.workspace.output}

**AVAILABLE SKILLS:**
${skillsToXml(skills)}

**INSTRUCTIONS:**
1. When you need to process PDFs, first read the skill's SKILL.md for detailed instructions
2. The skill includes Python scripts in .skills/pdf/scripts/ that you can use
3. Install any required Python packages using pip before running scripts
4. Save all output files to the output/ directory

**IMPORTANT:**
- Use \`python3\` (not \`python\`) for running scripts
- Install required packages with \`pip3 install\` if needed
- Use the scripts provided in the skill when applicable
- Explain what you're doing at each step`;

  // 7. Wrap model with prompt caching
  const model = wrapLanguageModel({
    model: anthropic("claude-sonnet-4-5-20250929"),
    middleware: anthropicPromptCacheMiddleware,
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("\n🤖 Starting agent...\n");

  let stepNumber = 0;

  // 8. Run the agent
  const result = await generateText({
    model,
    tools,
    system: systemPrompt,
    prompt: `Process the PDF file at input/${pdfFilename}.

1. First, read the PDF skill instructions at .skills/pdf/SKILL.md to understand what tools and scripts are available.

2. Extract the text content from the PDF and save it to output/${pdfFilename.replace(
      ".pdf",
      ".txt",
    )}.

3. If the PDF appears to be a form, also extract the form field information.

4. Provide a brief summary of what the PDF contains.`,
    stopWhen: stepCountIs(20),
    onStepFinish: ({ finishReason, toolCalls, toolResults, text, usage }) => {
      stepNumber++;
      console.log(`\n${"-".repeat(60)}`);
      console.log(`📍 Step ${stepNumber} (${finishReason})`);
      console.log(`${"-".repeat(60)}`);

      if (toolCalls && toolCalls.length > 0) {
        for (const call of toolCalls) {
          console.log(`\n🔧 Tool: ${call.toolName}`);
          const input = call.input as Record<string, unknown>;

          // Format input nicely based on tool type
          if (call.toolName === "Bash" && input.command) {
            console.log(`   Command: ${input.command}`);
          } else if (call.toolName === "Read" && input.file_path) {
            console.log(`   Path: ${input.file_path}`);
          } else if (call.toolName === "Write" && input.file_path) {
            console.log(`   Path: ${input.file_path}`);
            const content = String(input.content || "");
            console.log(`   Content: ${content.length} chars`);
          } else {
            const inputStr = JSON.stringify(input, null, 2);
            const truncatedInput =
              inputStr.length > 500 ? `${inputStr.slice(0, 500)}...` : inputStr;
            console.log(
              `   Input: ${truncatedInput.split("\n").join("\n   ")}`,
            );
          }
        }
      }

      if (toolResults && toolResults.length > 0) {
        for (const res of toolResults) {
          const output = res.output as Record<string, unknown>;

          // Format output nicely based on result type
          if (output.stdout !== undefined) {
            // Bash output
            const stdout = String(output.stdout || "(empty)");
            const stderr = String(output.stderr || "");
            const exitCode = output.exit_code;
            console.log(`\n   ✅ Exit code: ${exitCode}`);
            if (stdout) {
              const truncatedStdout =
                stdout.length > 800
                  ? `${stdout.slice(0, 800)}\n   ... (truncated)\n`
                  : stdout;
              console.log(
                `   stdout:\n   ${truncatedStdout.split("\n").join("\n   ")}`,
              );
            }
            if (stderr) {
              console.log(`   stderr: ${stderr.slice(0, 200)}`);
            }
          } else if (output.content !== undefined) {
            // Read output
            const content = String(output.content);
            const truncated =
              content.length > 600
                ? `${content.slice(0, 600)}\n... (truncated)\n`
                : content;
            console.log(
              `\n   ✅ Content (${content.length} chars):\n   ${truncated
                .split("\n")
                .join("\n   ")}`,
            );
          } else if (output.success !== undefined) {
            // Write output
            console.log(`\n   ✅ Written successfully`);
          } else {
            const outputStr = JSON.stringify(output, null, 2);
            const truncated =
              outputStr.length > 600
                ? `${outputStr.slice(0, 600)}...`
                : outputStr;
            console.log(
              `\n   ✅ Result:\n   ${truncated.split("\n").join("\n   ")}`,
            );
          }
        }
      }

      if (text) {
        console.log(`\n💬 Agent: ${text}`);
      }

      if (usage) {
        console.log(
          `\n📊 Tokens: in=${usage.inputTokens} out=${usage.outputTokens}`,
        );
      }
    },
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("\n✅ Agent completed!\n");
  console.log("Final response:", result.text || "(no text response)");
  console.log("\n📈 Summary:");
  console.log("   Steps:", result.steps.length);
  console.log("   Input tokens:", result.usage.inputTokens);
  console.log("   Output tokens:", result.usage.outputTokens);

  const cacheCreation =
    result.providerMetadata?.anthropic?.cacheCreationInputTokens;
  const cacheRead = result.providerMetadata?.anthropic?.cacheReadInputTokens;
  if (cacheCreation || cacheRead) {
    console.log("   Cache creation:", cacheCreation || 0);
    console.log("   Cache read:", cacheRead || 0);
  }

  // Show what was created
  console.log("\n📂 Output files:");
  try {
    const outputFiles = await sandbox.readDir("output/");
    if (outputFiles.length > 0) {
      for (const file of outputFiles) {
        console.log(`   - output/${file}`);

        // Show preview of text files
        if (file.endsWith(".txt")) {
          try {
            const content = await sandbox.readFile(`output/${file}`);
            const preview = content.slice(0, 500);
            console.log("\n   Preview:");
            console.log(`   ${"-".repeat(40)}`);
            console.log(`   ${preview.split("\n").join("\n   ")}`);
            if (content.length > 500) {
              console.log("   ... (truncated)");
            }
            console.log(`   ${"-".repeat(40)}`);
          } catch {
            // Skip preview if can't read
          }
        }
      }
    } else {
      console.log("   (no files created)");
    }
  } catch {
    console.log("   (could not read output directory)");
  }

  console.log(`\n📁 Full output saved to: ${workspacePath}/output/`);

  // Cleanup
  await sandbox.destroy();
}

main().catch(console.error);
