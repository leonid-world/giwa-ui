<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

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
        businessNumber: businessNumber.value,
      })
    }
    else await auth.login(credentials)
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
          <input v-model="password" type="password" autocomplete="current-password" minlength="8" required />
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
            <input v-model="businessNumber" type="text" inputmode="numeric" required />
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
.auth-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.auth-card { width: min(100%, 420px); padding: 40px; border: 1px solid #dfe5e1; border-radius: 16px; background: #fff; box-shadow: 0 20px 50px rgba(24, 62, 48, 0.08); }
.eyebrow { color: #0b7654; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
h1 { margin-top: 8px; color: #15352b; font-size: 30px; font-weight: 700; }
.description { margin: 8px 0 28px; color: #62736b; }
form, label { display: grid; gap: 8px; }
form { gap: 18px; }
label { color: #27463b; font-size: 14px; font-weight: 600; }
input { width: 100%; padding: 12px; border: 1px solid #b8c7c0; border-radius: 8px; font: inherit; }
button { border: 0; border-radius: 8px; padding: 12px 16px; background: #0b7654; color: white; cursor: pointer; font: inherit; font-weight: 700; }
button:disabled { cursor: wait; opacity: 0.65; }
.text-button { width: 100%; margin-top: 16px; background: transparent; color: #0b7654; }
.error { margin: -6px 0 0; color: #ba1a1a; font-size: 14px; }
</style>
