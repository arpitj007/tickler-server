<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
// Pages under /guides/ are the same files the Tickler apps show offline.
// The apps fill in your own server address and token; the website shows examples.
const show = computed(() => route.path.includes('/guides/') && !route.path.includes('/guides/providers/'))
</script>

<template>
  <div v-if="show" class="guide-note">
    This guide is also in the Tickler app, where your server address and token are filled in for you.
    Here we show <code>https://your-server.example.com</code> and <code>tkm_your_token_here</code>:
    swap in your own.
  </div>
</template>

<style scoped>
.guide-note {
  margin: 0 0 24px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}
</style>
