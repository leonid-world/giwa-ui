<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'

const route = useRoute()
const auth = useAuthStore()
const userLoadFailed = ref(false)
const showAuthenticatedLayout = computed(
  () => Boolean(route.meta.requiresAuth) && auth.isAuthenticated,
)
const accountLabel = computed(() => {
  if (auth.user?.email) return auth.user.email
  return userLoadFailed.value ? '계정 확인 실패' : '계정 확인 중...'
})

watch(
  [showAuthenticatedLayout, () => route.fullPath],
  async ([isAuthenticatedPage]) => {
    if (!isAuthenticatedPage) {
      userLoadFailed.value = false
      return
    }
    if (auth.user) return

    try {
      await auth.loadUser()
      userLoadFailed.value = false
    } catch {
      userLoadFailed.value = true
    }
  },
  { immediate: true },
)
</script>

<template>
  <div :class="{ 'authenticated-shell': showAuthenticatedLayout }">
    <header
      v-if="showAuthenticatedLayout"
      class="session-bar"
      aria-label="현재 로그인 사용자"
    >
      <div class="session-bar__inner">
        <div class="session-account" :title="auth.user?.email">
          <span>로그인 계정</span>
          <strong>{{ accountLabel }}</strong>
        </div>
      </div>
    </header>
    <div :class="{ 'authenticated-route': showAuthenticatedLayout }">
      <RouterView />
    </div>
  </div>
</template>

<style>
.authenticated-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.session-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid #dfe5e1;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
}

.session-bar__inner {
  display: flex;
  justify-content: flex-end;
  width: min(calc(100% - 48px), 1180px);
  min-width: 0;
  margin: 0 auto;
  padding: 9px 0;
}

.session-account {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 8px;
  padding: 6px 11px;
  border: 1px solid #dfe5e1;
  border-radius: 999px;
  background: #f4f8f5;
  color: #15352b;
  line-height: 1.3;
}

.session-account span {
  flex: 0 0 auto;
  color: #62736b;
  font-size: 12px;
}

.session-account strong {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.authenticated-route {
  min-height: 0;
}

.authenticated-shell .authenticated-route > main {
  min-height: 100%;
}

@media (max-width: 560px) {
  .session-bar__inner {
    width: min(calc(100% - 32px), 1180px);
  }

  .session-account {
    width: 100%;
  }

  .session-account strong {
    max-width: none;
  }
}
</style>
