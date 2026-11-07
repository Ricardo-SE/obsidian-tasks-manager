import esbuild from 'esbuild';
import process from 'node:process';

const prod = process.argv.includes('--production') || process.argv.includes('-p');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  treeShaking: true,
  sourcemap: prod ? false : 'inline',
  minify: prod,
  outfile: 'main.js',
});

if (watch) {
  await context.watch();
  console.log('[tasks manager] 监听中，改完保存自动重建');
} else {
  await context.rebuild();
  await context.dispose();
  console.log(`[tasks manager] 构建完成${prod ? '（生产）' : ''}`);
}
