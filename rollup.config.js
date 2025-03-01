import typescript from '@rollup/plugin-typescript';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'main.ts',
  output: {
    dir: '.',
    sourcemap: false,
    format: 'cjs',
    exports: 'default'
  },
  external: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      'obsidian'
  ],
  plugins: [
    typescript({
      sourceMap: false,
      inlineSources: false,
      inlineSourceMap: false
    }),
    nodeResolve({browser: true}),
    commonjs({
      sourceMap: false
    }),
  ]
};