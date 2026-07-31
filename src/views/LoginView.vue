<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
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
      <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
      <h1>{{ isSignup ? '계정을 만드세요' : '다시 오셨군요' }}</h1>
      <p class="description">매출채권 금융을 관리하려면 로그인하세요.</p>

      <form @submit.prevent="submit">
        <label>
          이메일
          <input v-model="email" type="email" autocomplete="email" required />
        </label>
        <label>
          비밀번호
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
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
            <input v-model="companyName" type="text" required />
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
        <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '처리 중...' : isSignup ? '회원가입' : '로그인' }}
        </button>
      </form>

      <button class="text-button" type="button" @click="toggleMode">
        {{ isSignup ? '이미 계정이 있으신가요? 로그인' : '처음이신가요? 회원가입' }}
      </button>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: clamp(24px, 5vw, 48px);
}

.auth-card {
  width: min(100%, 420px);
  padding: 40px;
  border: 1px solid #dce5e0;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(24, 62, 48, 0.09);
}

.eyebrow {
  margin: 0;
  color: #0b7654;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
}

h1 {
  margin: 8px 0 0;
  color: #15352b;
  font-size: 30px;
  font-weight: 750;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

.description {
  margin: 8px 0 28px;
  color: #62736b;
  line-height: 1.6;
}

form,
label {
  display: grid;
  gap: 8px;
}

form {
  gap: 18px;
}

label {
  color: #27463b;
  font-size: 14px;
  font-weight: 650;
}

input {
  width: 100%;
  min-height: 46px;
  padding: 11px 12px;
  border: 1px solid #b8c7c0;
  border-radius: 9px;
  outline: none;
  background: #fbfdfc;
  color: #15352b;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}

input:hover {
  border-color: #8fa69b;
  background: #ffffff;
}

input:focus {
  border-color: #0b7654;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(11, 118, 84, 0.12);
}

button {
  min-height: 46px;
  border: 0;
  border-radius: 9px;
  padding: 11px 16px;
  background: #0b7654;
  color: white;
  cursor: pointer;
  font-weight: 700;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

button:hover:not(:disabled) {
  background: #075f44;
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
  margin-top: 14px;
  background: transparent;
  color: #0b7654;
}

.text-button:hover:not(:disabled) {
  background: #edf6f1;
}

.error {
  margin: -2px 0 0;
  padding: 11px 12px;
  border: 1px solid #efc0c0;
  border-radius: 9px;
  background: #fff5f5;
  color: #a32323;
  font-size: 14px;
  line-height: 1.5;
}

@media (max-width: 520px) {
  .auth-page {
    padding: 16px;
  }

  .auth-card {
    padding: 30px 22px;
  }
}
</style>
