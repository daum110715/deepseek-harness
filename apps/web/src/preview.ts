/**
 * Web platform bootstrap: the one module the browser-hosted page adds ahead of the
 * stock entry tag. A `preview-fixture` query keeps the ephemeral fixture chooser
 * the packaging regressions drive. Everything after these calls is the served
 * startup chain verbatim.
 */
import DshWorker from '@deepseek-ai/dsh-experimental-webworker-runtime/worker?worker'
import {
  chooseWorkerHostSource, connectWorkerHost, IMAGE_FILE_NAME, startWebPlatform,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/client'

const image = `preview/${IMAGE_FILE_NAME}`
const createWorker = (): Worker => new DshWorker({ name: 'dsh-host' })

if (new URLSearchParams(location.search).has('preview-fixture')) {
  const source = await chooseWorkerHostSource({ image })
  await connectWorkerHost(createWorker(), { image, overlays: source.overlays })
} else {
  await startWebPlatform({ image, createWorker })
}
