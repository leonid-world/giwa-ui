<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { FileText, HandCoins, Landmark, LayoutDashboard, ReceiptText, UserRound } from '@lucide/vue'
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
  <div class="app-shell" :class="{ 'authenticated-shell': showAuthenticatedLayout }">
    <a class="skip-link" href="#main-content">본문 바로가기</a>
    <header v-if="showAuthenticatedLayout" class="session-bar" aria-label="애플리케이션 헤더">
      <div class="session-bar__inner">
        <RouterLink class="app-brand" :to="{ name: 'dashboard' }">
          <span class="app-brand__mark" aria-hidden="true">
            <Landmark :size="18" :stroke-width="2" />
          </span>
          <span class="app-brand__copy">
            <strong>GIWA</strong>
            <span>Receivable Finance</span>
          </span>
        </RouterLink>
        <nav class="app-navigation" aria-label="주요 메뉴">
          <RouterLink :to="{ name: 'dashboard' }">
            <LayoutDashboard aria-hidden="true" :size="16" />
            대시보드
          </RouterLink>
          <RouterLink :to="{ name: 'receivables' }">
            <FileText aria-hidden="true" :size="16" />
            매출채권
          </RouterLink>
          <RouterLink :to="{ name: 'funding' }">
            <HandCoins aria-hidden="true" :size="16" />
            펀딩
          </RouterLink>
          <RouterLink :to="{ name: 'repayment' }">
            <ReceiptText aria-hidden="true" :size="16" />
            상환
          </RouterLink>
          <RouterLink :to="{ name: 'profile' }">
            <UserRound aria-hidden="true" :size="16" />
            내 정보
          </RouterLink>
        </nav>
        <RouterLink
          class="session-account"
          :to="{ name: 'profile' }"
          :title="auth.user?.email"
          aria-label="내 정보 보기"
        >
          <UserRound aria-hidden="true" :size="16" />
          <strong>{{ accountLabel }}</strong>
        </RouterLink>
      </div>
    </header>
    <div
      id="main-content"
      class="app-route"
      :class="{ 'authenticated-route': showAuthenticatedLayout }"
      tabindex="-1"
    >
      <RouterView />
    </div>
    <footer class="app-footer">
      <div class="app-footer__inner">
        <strong>GIWA Receivable Finance</strong>
        <span>GIWA Sepolia · Hackathon MVP · 데모 전용</span>
      </div>
    </footer>
  </div>
</template>

<style>
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.authenticated-shell {
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 200;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: #ffffff;
  font-weight: 700;
  text-decoration: none;
  transform: translateY(-160%);
  transition: transform var(--transition-fast);
}

.skip-link:focus {
  transform: translateY(0);
}

.session-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.session-bar__inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  width: min(calc(100% - 48px), var(--content-width));
  min-width: 0;
  margin: 0 auto;
  padding: var(--space-1) 0;
}

.app-brand {
  display: inline-flex;
  align-items: center;
  min-width: max-content;
  gap: var(--space-1);
  color: var(--color-text);
  text-decoration: none;
}

.app-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: #ffffff;
}

.app-brand__copy {
  display: grid;
  line-height: 1.15;
}

.app-brand__copy strong {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.app-brand__copy span {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.app-navigation {
  display: flex;
  justify-content: flex-start;
  min-width: 0;
  gap: var(--space-1);
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
  gap: var(--space-1);
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.app-navigation a:hover {
  background: var(--color-surface-subtle);
  color: var(--color-text);
}

.app-navigation a.router-link-active {
  border-color: #d7e9e1;
  background: var(--color-brand-soft);
  color: var(--color-brand);
}

.session-account {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 280px;
  gap: var(--space-1);
  min-height: 40px;
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  line-height: 1.2;
  text-decoration: none;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast);
}

.session-account svg {
  flex: 0 0 auto;
}

.session-account:hover,
.session-account.router-link-active {
  border-color: var(--color-border);
  background: var(--color-surface-subtle);
}

.session-account strong {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-route,
.authenticated-route {
  min-height: 0;
}

.authenticated-shell .authenticated-route > main {
  min-height: 100%;
}

.app-shell:not(.authenticated-shell) .app-route > main {
  min-height: 100%;
}

.app-footer {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
}

.app-footer__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(calc(100% - 48px), var(--content-width));
  min-height: 56px;
  gap: var(--space-2);
  margin: 0 auto;
  padding: var(--space-2) 0;
  font-size: 12px;
}

.app-footer__inner strong {
  color: var(--color-text);
  font-weight: 600;
}

@media (max-width: 900px) {
  .session-bar__inner {
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-1) var(--space-2);
    padding: var(--space-1) 0;
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
    width: min(calc(100% - 32px), var(--content-width));
  }

  .session-account {
    max-width: min(100%, 160px);
  }

  .app-brand__copy > span {
    display: none;
  }

  .session-account strong {
    max-width: none;
  }

  .app-footer__inner {
    width: min(calc(100% - 32px), var(--content-width));
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-1);
  }
}

.app-brand:focus-visible,
.app-navigation a:focus-visible,
.session-account:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.24);
  outline-offset: 2px;
}
</style>
