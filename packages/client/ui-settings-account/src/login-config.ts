/** Account authentication availability shared by Host and Client bootstrap. */
import z from '@deepseek-ai/schemastery'

/** Bootstrap key carrying the deployment's account authentication choice. */
export const ACCOUNT_LOGIN_GLOBAL = '__DSH_ACCOUNT_LOGIN_ENABLED__'
/** Account authentication is enabled unless the deployment explicitly disables it. */
export const AccountLoginEnabled = z.boolean().default(true)
