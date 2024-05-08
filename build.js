const consola = require('consola')
const { rollup } = require('rollup')
const { babel } = require('@rollup/plugin-babel')
const { nodeResolve: resolve } = require('@rollup/plugin-node-resolve')
const commonjs = require('@rollup/plugin-commonjs')
const typescript = require('@rollup/plugin-typescript')
const pkg = require('./package.json')
const tsConfig = require('./tsconfig.json')
const fs = require('fs')
const path = require('path')

let promise = Promise.resolve()

// Clean up the output directory
promise = promise.then(() => {
  if (!fs.existsSync('./dist/')) {
    consola.info('dist directory not exist')
    return
  }
  fs.readdirSync('./dist/', (err, files) => {
    if (err) throw err;
    
    for (const file of files) {
      fs.unlink(path.join('./dist/', file), err => {
        if (err) throw err;
      });
    }
  })
  consola.success('Dist directory cleanup')
})
const formats = ['es', 'cjs', 'umd']

const InputOptions = {
  input: 'src/index.ts',
  external: Object.keys(pkg.dependencies),
  plugins: [
    resolve(),
    typescript(tsConfig.compilerOptions),
    babel(Object.assign(pkg.babel, {
      babelrc: false,
      exclude: 'node_modules/**',
      babelHelpers: 'runtime',
      presets: pkg.babel.presets.map(x => (x === 'latest' ? ['latest', { es2018: { modules: false } }] : x))
    })),
    commonjs({
      extensions: ['.ts', '.js']
    })
  ]
}
consola.log('Start')
const result = formats.map(async (format) => {
  const OutputOptions = {
    file: `dist/${format === 'cjs' ? 'index' : `index.${format}`}.js`,
    format,
    exports: 'named',
    globals: {
      lodash: 'lodash',
    },
    sourcemap: true,
    name: format === 'umd' ? pkg.name : undefined
  }

  const bundle = await promise.then(() => rollup(InputOptions))

  await bundle.write(OutputOptions)

  consola.success(`Write ${format} bundle success`)
})

Promise.all(result)
  .then(() => {
    consola.success('Enjoy!')
  })

promise.catch(err => consola.error(err.stack)) // eslint-disable-line no-console
