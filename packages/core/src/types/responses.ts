import type { ResponsesOptions } from '@xsai-ext/responses'

export type ItemParam = Exclude<ResponsesOptions['input'], string>[number]
