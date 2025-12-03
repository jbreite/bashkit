#!/usr/bin/env node
import { select, confirm, intro, outro, spinner } from '@clack/prompts';
import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Check if a package is installed in the current project
 */
function checkInstalled(pkg: string): boolean {
  try {
    require.resolve(pkg, { paths: [process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which package manager is being used
 */
function detectPackageManager(): 'bun' | 'npm' | 'yarn' | 'pnpm' {
  const userAgent = process.env.npm_config_user_agent || '';

  if (userAgent.includes('bun')) return 'bun';
  if (userAgent.includes('yarn')) return 'yarn';
  if (userAgent.includes('pnpm')) return 'pnpm';
  return 'npm';
}

/**
 * Get the install command for the detected package manager
 */
function getInstallCommand(pm: string): string {
  switch (pm) {
    case 'bun': return 'bun add';
    case 'yarn': return 'yarn add';
    case 'pnpm': return 'pnpm add';
    default: return 'npm install';
  }
}

/**
 * Create a bashkit config file
 */
function createConfigFile(sandbox: string, webTools: boolean) {
  const configContent = `import { create${sandbox}Sandbox, createAgentTools } from 'bashkit';
import type { AgentConfig } from 'bashkit';

// Create sandbox
export const sandbox = create${sandbox}Sandbox(${
  sandbox === 'Local' ? '{\n  workingDirectory: process.cwd()\n}' : ''
});

// Configure tools
export const config: AgentConfig = {${
  webTools ? '\n  webSearch: {\n    apiKey: process.env.PARALLEL_API_KEY\n  }\n' : ''
}};

// Create tools
export const tools = createAgentTools(sandbox${webTools ? ', config' : ''});
`;

  const configPath = join(process.cwd(), 'bashkit.config.ts');

  if (existsSync(configPath)) {
    console.log('\n⚠️  bashkit.config.ts already exists, skipping creation');
  } else {
    writeFileSync(configPath, configContent);
    console.log('\n✅ Created bashkit.config.ts');
  }
}

async function init() {
  intro('🛠️  BashKit Setup');

  // Check what's already installed
  const hasAI = checkInstalled('ai');
  const hasZod = checkInstalled('zod');
  const hasVercel = checkInstalled('@vercel/sandbox');
  const hasE2B = checkInstalled('@e2b/code-interpreter');
  const hasWeb = checkInstalled('parallel-web');

  // Show status
  console.log('\n📦 Dependency check:');
  console.log(`  ${hasAI ? '✅' : '❌'} ai`);
  console.log(`  ${hasZod ? '✅' : '❌'} zod`);
  console.log(`  ${hasVercel ? '✅' : '⚪'} @vercel/sandbox (optional)`);
  console.log(`  ${hasE2B ? '✅' : '⚪'} @e2b/code-interpreter (optional)`);
  console.log(`  ${hasWeb ? '✅' : '⚪'} parallel-web (optional)`);

  // Ask about sandbox
  const sandboxChoice = await select({
    message: 'Which sandbox environment would you like to use?',
    options: [
      {
        value: 'Local',
        label: 'LocalSandbox',
        hint: 'Bun-based, best for development (no additional deps)'
      },
      {
        value: 'Vercel',
        label: 'VercelSandbox',
        hint: hasVercel ? 'Already installed ✓' : 'Production-ready, requires @vercel/sandbox'
      },
      {
        value: 'E2B',
        label: 'E2BSandbox',
        hint: hasE2B ? 'Already installed ✓' : 'Hosted execution, requires @e2b/code-interpreter'
      },
    ],
  });

  if (!sandboxChoice || typeof sandboxChoice !== 'string') {
    outro('Setup cancelled');
    process.exit(0);
  }

  // Ask about web tools
  const webTools = await confirm({
    message: 'Enable WebSearch and WebFetch tools?',
    initialValue: hasWeb,
  });

  if (typeof webTools !== 'boolean') {
    outro('Setup cancelled');
    process.exit(0);
  }

  // Determine what needs to be installed
  const toInstall: string[] = [];
  if (!hasAI) toInstall.push('ai');
  if (!hasZod) toInstall.push('zod');
  if (sandboxChoice === 'Vercel' && !hasVercel) toInstall.push('@vercel/sandbox');
  if (sandboxChoice === 'E2B' && !hasE2B) toInstall.push('@e2b/code-interpreter');
  if (webTools && !hasWeb) toInstall.push('parallel-web');

  // Install dependencies
  if (toInstall.length === 0) {
    console.log('\n✅ All required dependencies already installed!');
  } else {
    const pm = detectPackageManager();
    const installCmd = getInstallCommand(pm);

    console.log(`\n📦 Installing missing dependencies: ${toInstall.join(', ')}`);
    console.log(`   Using: ${pm}\n`);

    const s = spinner();
    s.start('Installing...');

    try {
      execSync(`${installCmd} ${toInstall.join(' ')}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      s.stop('Dependencies installed ✓');
    } catch (error) {
      s.stop('Installation failed ✗');
      console.error('\n❌ Failed to install dependencies');
      console.error('Please try installing manually:', `${installCmd} ${toInstall.join(' ')}`);
      process.exit(1);
  }

  // Create config file
  createConfigFile(sandboxChoice, webTools);

  // Show next steps
  outro('✅ Setup complete!');

  console.log('\n📚 Next steps:');
  console.log('  1. Import your tools:');
  console.log('     import { tools } from \'./bashkit.config\';\n');
  console.log('  2. Use with Vercel AI SDK:');
  console.log('     import { streamText } from \'ai\';');
  console.log('     import { anthropic } from \'@ai-sdk/anthropic\';\n');
  console.log('     const result = streamText({');
  console.log('       model: anthropic(\'claude-sonnet-4-5\'),');
  console.log('       tools,');
  console.log('       messages: [{ role: \'user\', content: \'List files\' }]');
  console.log('     });');

  if (webTools) {
    console.log('\n  3. Set your API key for web tools:');
    console.log('     export PARALLEL_API_KEY=your_key');
  }

  console.log('\n📖 Docs: https://github.com/jbreite/bashkit');
}

init().catch((error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
