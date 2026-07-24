import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { siteUrl, hasDomain } from './site.config'

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  // Static output: Cloudflare Pages serves /dist, and /functions handles the API.
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [react(), ...(hasDomain ? [sitemap()] : [])],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Keep the CSS in one file so the Studio's runtime theme overrides
    // always apply after the stylesheet, never before it.
    inlineStylesheets: 'never',
  },
  devToolbar: { enabled: false },
})
