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
    <header v-if="showAuthenticatedLayout" class="session-bar" aria-label="현재 로그인 사용자">
      <div class="session-bar__inner">
        <RouterLink class="app-brand" :to="{ name: 'dashboard' }">
          <span>GIWA</span>
          <strong>Receivable Finance</strong>
        </RouterLink>
        <nav class="app-navigation" aria-label="주요 메뉴">
          <RouterLink :to="{ name: 'dashboard' }">대시보드</RouterLink>
          <RouterLink :to="{ name: 'receivables' }">매출채권</RouterLink>
          <RouterLink :to="{ name: 'funding' }">펀딩</RouterLink>
          <RouterLink :to="{ name: 'repayment' }">상환</RouterLink>
          <RouterLink :to="{ name: 'profile' }">내 정보</RouterLink>
        </nav>
        <RouterLink
          class="session-account"
          :to="{ name: 'profile' }"
          :title="auth.user?.email"
          aria-label="내 정보 보기"
        >
          <span>내 정보</span>
          <strong>{{ accountLabel }}</strong>
        </RouterLink>
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
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(24, 62, 48, 0.04);
}

.session-bar__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  width: min(calc(100% - 48px), 1180px);
  min-width: 0;
  margin: 0 auto;
  padding: 10px 0;
}

.app-brand {
  display: grid;
  min-width: max-content;
  color: #15352b;
  line-height: 1.1;
  text-decoration: none;
}

.app-brand span {
  color: #0b7654;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.app-brand strong {
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
}

.app-navigation {
  display: flex;
  justify-content: center;
  min-width: 0;
  gap: 3px;
  overflow-x: auto;
  scrollbar-width: none;
}

.app-navigation::-webkit-scrollbar {
  display: none;
}

.app-navigation a {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 8px 11px;
  color: #52675e;
  font-size: 14px;
  font-weight: 650;
  text-decoration: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.app-navigation a:hover,
.app-navigation a.router-link-active {
  border-color: #d9e9e1;
  background: #e8f4ee;
  color: #0b7654;
}

.session-account {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 310px;
  gap: 8px;
  min-height: 40px;
  padding: 6px 11px;
  border: 1px solid #d7e2dc;
  border-radius: 999px;
  background: #f7faf8;
  color: #15352b;
  line-height: 1.3;
  text-decoration: none;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;
}

.session-account:hover,
.session-account.router-link-active {
  border-color: #8fc6b1;
  background: #e8f4ee;
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

@media (max-width: 900px) {
  .session-bar__inner {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 7px 16px;
    padding: 10px 0 8px;
  }

  .app-navigation {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
  }

  .session-account {
    justify-self: end;
  }
}

@media (max-width: 560px) {
  .session-bar__inner {
    width: min(calc(100% - 32px), 1180px);
  }

  .session-account {
    max-width: min(100%, 220px);
  }

  .session-account strong {
    max-width: none;
  }
}

.app-brand:focus-visible,
.app-navigation a:focus-visible,
.session-account:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.3);
  outline-offset: 2px;
}
</style>
