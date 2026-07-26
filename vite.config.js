import { defineConfig } from 'vite';

export default defineConfig({
  // Setting base to './' ensures that all asset links are relative, 
  // which prevents 404 errors when hosted on GitHub Pages subdirectories.
  base: '/Augmented-Reality-Gradien/', 
});
