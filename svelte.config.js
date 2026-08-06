import adapter from '@sveltejs/adapter-static'
import {vitePreprocess} from '@sveltejs/kit/vite'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],

  kit: {
    // 404.html is the SPA fallback served by clask for unknown paths
    // (deep links like /<relay>'<group>); index.html is a copy of it made
    // in the build script so the root path still gets a 200
    adapter: adapter({fallback: '404.html'})
  }
}

export default config
