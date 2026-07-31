import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'

const SITE_TITLE = 'GIWA Receivable Finance'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true, title: '로그인' },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      meta: { requiresAuth: true, noindex: true, title: '대시보드' },
    },
    {
      path: '/receivables',
      name: 'receivables',
      component: () => import('../views/ReceivablesView.vue'),
      meta: { requiresAuth: true, noindex: true, title: '매출채권' },
    },
    {
      path: '/funding',
      name: 'funding',
      component: () => import('../views/FundingView.vue'),
      meta: { requiresAuth: true, noindex: true, title: '채권 펀딩' },
    },
    {
      path: '/repayment',
      name: 'repayment',
      component: () => import('../views/RepaymentView.vue'),
      meta: { requiresAuth: true, noindex: true, title: '채권 상환' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: { requiresAuth: true, noindex: true, title: '내 정보' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
      meta: { noindex: true, title: '페이지를 찾을 수 없음' },
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isAuthenticated) return { name: 'login' }
  if (to.meta.guestOnly && auth.isAuthenticated) return { name: 'dashboard' }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} | ${SITE_TITLE}` : SITE_TITLE
  document
    .querySelector('meta[name="robots"]')
    ?.setAttribute('content', to.meta.noindex ? 'noindex, nofollow' : 'index, follow')
})

export default router
