import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import EasyParcelFulfillmentProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [EasyParcelFulfillmentProviderService],
})


