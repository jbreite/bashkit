import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox/interface";
import type { ToolConfig } from "../types";

export interface EditOutput {
  message: string;
  file_path: string;
  replacements: number;
}

export interface EditError {
  error: string;
}

const editInputSchema = z.object({
  file_path: z.string().describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The text to replace"),
  new_string: z
    .string()
    .describe(
      "The text to replace it with (must be different from old_string)"
    ),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace all occurrences of old_string (default false)"),
});

type EditInput = z.infer<typeof editInputSchema>;

export function createEditTool(sandbox: Sandbox, config?: ToolConfig) {
  return tool({
    description: "Performs exact string replacements in files.",
    inputSchema: zodSchema(editInputSchema),
    execute: async ({
      file_path,
      old_string,
      new_string,
      replace_all = false,
    }: EditInput): Promise<EditOutput | EditError> => {
      // Validate old_string !== new_string
      if (old_string === new_string) {
        return { error: "old_string and new_string must be different" };
      }

      // Check allowed paths
      if (config?.allowedPaths) {
        const isAllowed = config.allowedPaths.some((allowed) =>
          file_path.startsWith(allowed)
        );
        if (!isAllowed) {
          return { error: `Path not allowed: ${file_path}` };
        }
      }

      try {
        const exists = await sandbox.fileExists(file_path);
        if (!exists) {
          return { error: `File not found: ${file_path}` };
        }

        const content = await sandbox.readFile(file_path);

        // Count occurrences
        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) {
          return { error: `String not found in file: "${old_string}"` };
        }

        // If not replace_all, ensure string is unique
        if (!replace_all && occurrences > 1) {
          return {
            error: `String appears ${occurrences} times in file. Use replace_all=true to replace all, or provide a more unique string.`,
          };
        }

        // Perform replacement
        let newContent: string;
        let replacements: number;

        if (replace_all) {
          newContent = content.split(old_string).join(new_string);
          replacements = occurrences;
        } else {
          newContent = content.replace(old_string, new_string);
          replacements = 1;
        }

        await sandbox.writeFile(file_path, newContent);

        return {
          message: `Successfully edited ${file_path}`,
          file_path,
          replacements,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  });
}
