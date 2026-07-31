<script setup>
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const destination = computed(() =>
  auth.isAuthenticated ? { name: 'dashboard' } : { name: 'login' },
)
const destinationLabel = computed(() =>
  auth.isAuthenticated ? '대시보드로 이동' : '로그인으로 이동',
)
</script>

<template>
  <main class="not-found-page" aria-labelledby="not-found-title">
    <section class="not-found-card">
      <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
      <strong class="error-code">404</strong>
      <h1 id="not-found-title">페이지를 찾을 수 없습니다.</h1>
      <p class="description">
        주소가 변경되었거나 존재하지 않는 페이지입니다. 안전한 시작 화면으로 돌아가 주세요.
      </p>
      <RouterLink :to="destination">{{ destinationLabel }}</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.not-found-page {
  display: grid;
  min-height: 100%;
  place-items: center;
  padding: clamp(24px, 5vw, 48px);
}

.not-found-card {
  width: min(100%, 520px);
  padding: 40px;
  border: 1px solid #dce5e0;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(24, 62, 48, 0.08);
}

.eyebrow {
  margin: 0;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

.error-code {
  display: block;
  margin-top: 24px;
  color: #b8c7c0;
  font-size: clamp(52px, 12vw, 82px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
}

h1 {
  margin: 14px 0 0;
  color: #15352b;
  font-size: clamp(28px, 6vw, 36px);
  font-weight: 750;
  line-height: 1.25;
  letter-spacing: -0.025em;
}

.description {
  margin: 12px 0 28px;
  color: #62736b;
  line-height: 1.65;
}

a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  border-radius: 9px;
  padding: 11px 16px;
  background: #0b7654;
  color: #ffffff;
  font-weight: 700;
  text-decoration: none;
  transition: background-color 0.16s ease;
}

a:hover {
  background: #075f44;
}

a:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.28);
  outline-offset: 2px;
}

@media (max-width: 520px) {
  .not-found-page {
    padding: 16px;
  }

  .not-found-card {
    padding: 30px 22px;
  }
}
</style>
