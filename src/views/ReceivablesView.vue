<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useReceivableStore } from '../stores/receivable'

const router = useRouter()
const receivableStore = useReceivableStore()
const errorMessage = ref('')
const successMessage = ref('')
const isSubmitting = ref(false)
const showForm = ref(false)
const form = reactive({
  buyerBusinessNumber: '',
  faceValue: '',
  fundingAmount: '',
  issueDate: new Date().toISOString().slice(0, 10),
  maturityDate: '',
  documentHash: '',
  description: '',
})

onMounted(loadReceivables)

async function loadReceivables() {
  errorMessage.value = ''
  try {
    await receivableStore.loadAll()
  } catch (error) {
    errorMessage.value = error.message
  }
}

async function submit() {
  errorMessage.value = ''
  successMessage.value = ''
  isSubmitting.value = true
  try {
    await receivableStore.create({
      ...form,
      documentHash: form.documentHash || null,
      description: form.description || null,
    })
    successMessage.value = '매출채권이 등록되었습니다.'
    showForm.value = false
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isSubmitting.value = false
  }
}

async function selectReceivable(receivableId) {
  errorMessage.value = ''
  try {
    await receivableStore.loadOne(receivableId)
  } catch (error) {
    errorMessage.value = error.message
  }
}

function formatAmount(value) {
  if (value == null) return '-'
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
</script>

<template>
  <main class="receivables-page">
    <header>
      <div>
        <p class="eyebrow">GIWA RECEIVABLE FINANCE</p>
        <h1>매출채권</h1>
      </div>
      <div class="header-actions">
        <button class="secondary" type="button" @click="router.push({ name: 'dashboard' })">대시보드</button>
        <button type="button" @click="showForm = !showForm">
          {{ showForm ? '등록 취소' : '새 채권 등록' }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="message error" role="alert">{{ errorMessage }}</p>
    <p v-if="successMessage" class="message success">{{ successMessage }}</p>

    <section v-if="showForm" class="panel">
      <h2>매출채권 등록</h2>
      <form @submit.prevent="submit">
        <label>
          Buyer 사업자등록번호
          <input v-model="form.buyerBusinessNumber" maxlength="30" required />
        </label>
        <div class="two-columns">
          <label>
            채권 금액 (KRW)
            <input v-model="form.faceValue" type="number" min="1" step="1" required />
          </label>
          <label>
            펀딩 요청 금액 (KRW)
            <input v-model="form.fundingAmount" type="number" min="1" step="1" required />
          </label>
          <label>
            발행일
            <input v-model="form.issueDate" type="date" required />
          </label>
          <label>
            만기일
            <input v-model="form.maturityDate" type="date" required />
          </label>
        </div>
        <label>
          문서 SHA-256 해시 (선택)
          <input v-model="form.documentHash" maxlength="66" placeholder="0x..." />
        </label>
        <label>
          설명 (선택)
          <textarea v-model="form.description" maxlength="1000" rows="3"></textarea>
        </label>
        <button type="submit" :disabled="isSubmitting">
          {{ isSubmitting ? '등록 중...' : '등록' }}
        </button>
      </form>
    </section>

    <div class="content-grid">
      <section class="panel">
        <h2>채권 목록</h2>
        <p v-if="!receivableStore.receivables.length" class="empty">등록되거나 배정된 채권이 없습니다.</p>
        <button
          v-for="item in receivableStore.receivables"
          :key="item.receivableId"
          class="receivable-row"
          type="button"
          @click="selectReceivable(item.receivableId)"
        >
          <span>
            <strong>#{{ item.receivableId }} · {{ item.buyerCompanyName }}</strong>
            <small>{{ item.issueDate }} → {{ item.maturityDate }}</small>
          </span>
          <span class="amount">{{ formatAmount(item.faceValue) }} {{ item.currencyCode }}</span>
          <span class="status">{{ item.status }}</span>
        </button>
      </section>

      <section class="panel details">
        <h2>상세 정보</h2>
        <template v-if="receivableStore.selectedReceivable">
          <dl>
            <dt>채권 번호</dt><dd>#{{ receivableStore.selectedReceivable.receivableId }}</dd>
            <dt>Seller</dt><dd>{{ receivableStore.selectedReceivable.sellerCompanyName }}</dd>
            <dt>Buyer</dt><dd>{{ receivableStore.selectedReceivable.buyerCompanyName }}</dd>
            <dt>채권 금액</dt><dd>{{ formatAmount(receivableStore.selectedReceivable.faceValue) }} KRW</dd>
            <dt>펀딩 요청</dt><dd>{{ formatAmount(receivableStore.selectedReceivable.fundingAmount) }} KRW</dd>
            <dt>상태</dt><dd>{{ receivableStore.selectedReceivable.status }}</dd>
            <dt>설명</dt><dd>{{ receivableStore.selectedReceivable.description || '-' }}</dd>
          </dl>
        </template>
        <p v-else class="empty">목록에서 채권을 선택하세요.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.receivables-page { min-height: 100vh; padding: 32px; }
header { display: flex; justify-content: space-between; gap: 20px; align-items: center; max-width: 1180px; margin: 0 auto 24px; }
.eyebrow { color: #0b7654; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
h1 { color: #15352b; font-size: 32px; font-weight: 700; }
h2 { margin-bottom: 18px; color: #15352b; font-size: 20px; font-weight: 700; }
.header-actions { display: flex; gap: 10px; }
.panel { max-width: 1180px; margin: 0 auto 20px; padding: 24px; border: 1px solid #dfe5e1; border-radius: 14px; background: white; }
form, label { display: grid; gap: 8px; }
form { gap: 16px; }
.two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
label { color: #27463b; font-size: 14px; font-weight: 600; }
input, textarea { width: 100%; padding: 11px 12px; border: 1px solid #b8c7c0; border-radius: 8px; font: inherit; resize: vertical; }
button { border: 0; border-radius: 8px; padding: 11px 16px; background: #0b7654; color: white; cursor: pointer; font: inherit; font-weight: 700; }
button:disabled { cursor: not-allowed; opacity: .55; }
.secondary { border: 1px solid #9eb2a8; background: white; color: #315548; }
.message { max-width: 1180px; margin: 0 auto 16px; padding: 12px 16px; border-radius: 8px; }
.error { background: #fff0f0; color: #ba1a1a; }
.success { background: #e8f7ef; color: #0b7654; }
.content-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 20px; max-width: 1180px; margin: 0 auto; }
.content-grid .panel { width: 100%; margin: 0; }
.receivable-row { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; width: 100%; margin-top: 10px; text-align: left; background: #f4f8f5; color: #15352b; }
.receivable-row span:first-child { display: grid; }
.receivable-row small { color: #62736b; }
.amount { font-variant-numeric: tabular-nums; }
.status { padding: 4px 8px; border-radius: 999px; background: #dff2e8; color: #0b7654; font-size: 12px; }
.empty { color: #788a82; }
dl { display: grid; grid-template-columns: 110px 1fr; gap: 12px; }
dt { color: #788a82; }
dd { color: #15352b; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .receivables-page { padding: 20px; }
  header { align-items: flex-start; flex-direction: column; }
  .two-columns, .content-grid { grid-template-columns: 1fr; }
  .receivable-row { grid-template-columns: 1fr; }
}
</style>
