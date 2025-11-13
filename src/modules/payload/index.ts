import PayloadModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const PAYLOAD_MODULE = "payload"

export default Module(PAYLOAD_MODULE, {
  service: PayloadModuleService,
})
