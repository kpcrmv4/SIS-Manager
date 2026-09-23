import { getRequestConfig } from 'next-intl/server'

// Replaced in P0-03 with the staff/customer catalog split.
export default getRequestConfig(async () => ({
  locale: 'th',
  messages: {},
  timeZone: 'Asia/Bangkok',
}))
