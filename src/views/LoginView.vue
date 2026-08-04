<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CircleAlert, Landmark, LoaderCircle, LogIn, UserPlus } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { formatBusinessNumber, normalizeBusinessNumber } from '../utils/businessNumber'

const router = useRouter()
const auth = useAuthStore()
const isSignup = ref(false)
const email = ref('')
const password = ref('')
const userName = ref('')
const companyName = ref('')
const businessNumber = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

async function submit() {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const credentials = { email: email.value, password: password.value }
    if (isSignup.value) {
      await auth.signup({
        ...credentials,
        userName: userName.value,
        companyName: companyName.value,
        businessNumber: normalizeBusinessNumber(businessNumber.value),
      })
    } else await auth.login(credentials)
    router.push({ name: 'dashboard' })
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isSubmitting.value = false
  }
}

function toggleMode() {
  isSignup.value = !isSignup.value
  errorMessage.value = ''
}

function updateBusinessNumber(event) {
  businessNumber.value = formatBusinessNumber(event.target.value)
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card">
      <header class="auth-heading">
        <div class="auth-brand" aria-label="GIWA Receivable Finance">
          <span class="auth-brand__mark" aria-hidden="true">
            <Landmark :size="20" :stroke-width="2" />
          </span>
          <span>GIWA Receivable Finance</span>
        </div>
        <h1>{{ isSignup ? '계정을 만드세요' : '다시 오셨군요' }}</h1>
        <p class="description">매출채권 금융을 관리하려면 로그인하세요.</p>
      </header>

      <form :aria-busy="isSubmitting" @submit.prevent="submit">
        <label>
          이메일
          <input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label>
          비밀번호
          <input
            v-model="password"
            type="password"
            :autocomplete="isSignup ? 'new-password' : 'current-password'"
            minlength="8"
            required
          />
        </label>
        <template v-if="isSignup">
          <label>
            이름
            <input v-model="userName" type="text" autocomplete="name" required />
          </label>
          <label>
            회사명
            <input v-model="companyName" type="text" autocomplete="organization" required />
          </label>
          <label>
            사업자등록번호
            <input
              :value="businessNumber"
              type="text"
              inputmode="numeric"
              minlength="12"
              maxlength="12"
              pattern="[0-9]{3}-[0-9]{2}-[0-9]{5}"
              title="사업자등록번호 숫자 10자리를 입력해 주세요."
              required
              @input="updateBusinessNumber"
            />
          </label>
        </template>
        <div v-if="errorMessage" class="error" role="alert">
          <CircleAlert aria-hidden="true" :size="18" />
          <span>{{ errorMessage }}</span>
        </div>
        <button type="submit" :disabled="isSubmitting">
          <LoaderCircle v-if="isSubmitting" class="button-spinner" aria-hidden="true" :size="18" />
          <UserPlus v-else-if="isSignup" aria-hidden="true" :size="18" />
          <LogIn v-else aria-hidden="true" :size="18" />
          <span>{{ isSubmitting ? '처리 중...' : isSignup ? '회원가입' : '로그인' }}</span>
        </button>
      </form>

      <button class="text-button" type="button" :disabled="isSubmitting" @click="toggleMode">
        <span>{{ isSignup ? '이미 계정이 있으신가요? 로그인' : '처음이신가요? 회원가입' }}</span>
        <ArrowRight aria-hidden="true" :size="16" />
      </button>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: var(--space-8) var(--space-3);
}

.auth-card {
  width: min(100%, 400px);
}

.auth-heading {
  margin-bottom: var(--space-4);
}

.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

.auth-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-brand);
  color: #ffffff;
}

h1 {
  margin: var(--space-3) 0 0;
  color: var(--color-text);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.description {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}

form,
label {
  display: grid;
  gap: var(--space-1);
}

form {
  gap: var(--space-2);
}

label {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
}

input {
  width: 100%;
  min-height: 48px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  outline: none;
  background: var(--color-surface);
  color: var(--color-text);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

input:hover {
  border-color: #9ca9a3;
}

input:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(11, 118, 84, 0.12);
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 48px;
  border: 0;
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
  background: var(--color-brand);
  color: white;
  cursor: pointer;
  font-weight: 600;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

button:hover:not(:disabled) {
  background: var(--color-brand-hover);
}

button:focus-visible {
  outline: 3px solid rgba(11, 118, 84, 0.28);
  outline-offset: 2px;
}

button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.text-button {
  width: 100%;
  min-height: 40px;
  margin-top: var(--space-1);
  background: transparent;
  color: var(--color-brand);
  font-size: 14px;
}

.text-button:hover:not(:disabled) {
  background: var(--color-brand-soft);
}

.error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid #efc0c0;
  border-radius: var(--radius-md);
  background: #fffafa;
  color: #a32323;
  font-size: 14px;
  line-height: 1.5;
}

.error svg {
  flex: 0 0 auto;
  margin-top: 2px;
}

.button-spinner {
  animation: giwa-loading-spin 0.8s linear infinite;
}

@media (max-width: 520px) {
  .auth-page {
    padding: var(--space-5) var(--space-2);
  }

  .auth-card {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .button-spinner {
    animation: none;
  }
}
</style>
