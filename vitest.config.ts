import { defineConfig } from 'vitest/config'
import path from 'path'

// Unit tests only. The browser tests (tests/e2e) run under Playwright: `npm run test:e2e`.
export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        include: ['tests/unit/**/*.test.ts'],
        environment: 'node',
    },
})
