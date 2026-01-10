export type EasyParcelApiStatus = string

export type EasyParcelRateCheckingBulkRequest = {
  bulk: Array<{
    pick_code: string
    pick_state: string
    pick_country: "MY" | string
    send_code: string
    send_state: string
    send_country: "MY" | string
    weight: number
    width?: number
    length?: number
    height?: number
    date_coll?: string // YYYY-MM-DD
  }>
  exclude_fields?: string[]
}

export type EasyParcelRate = {
  rate_id?: string
  courier_id?: string
  courier_name?: string
  service_id?: string
  service_type?: string
  service_detail?: string
  price?: string | number
  delivery?: string
  [k: string]: unknown
}

export type EasyParcelRateCheckingBulkResponse = {
  api_status: EasyParcelApiStatus
  error_code?: number
  error_remark?: string
  result?: Array<{
    rates?: EasyParcelRate[]
    [k: string]: unknown
  }>
  [k: string]: unknown
}

// Order Submission Types
export type EasyParcelOrderItem = {
  pick_name: string
  pick_company?: string
  pick_contact: string
  pick_email?: string
  // EasyParcel API uses addr* field names
  pick_addr1: string
  pick_addr2?: string
  pick_addr3?: string
  pick_city: string
  pick_state: string
  pick_postcode: string
  pick_country: string
  
  send_name: string
  send_company?: string
  send_contact: string
  send_email?: string
  send_addr1: string
  send_addr2?: string
  send_addr3?: string
  send_city: string
  send_state: string
  send_postcode: string
  send_country: string
  
  service_id: string
  // ---- Alternate field names used by MPSubmitOrderBulk ----
  weight?: string | number
  width?: string | number
  length?: string | number
  height?: string | number
  content?: string
  value?: string | number
  pick_code?: string
  send_code?: string
  pick_mobile?: string
  send_mobile?: string
  collect_date?: string // YYYY-MM-DD
  sms?: string | number
  reference?: string
  // Some EasyParcel accounts require selecting a specific rate/courier explicitly.
  // These come from EP-RateCheckingBulk response.
  rate_id?: string
  courier_id?: string
  courier_name?: string
  price?: string | number
  // Some EasyParcel responses include numeric courier/service identifiers
  cid?: string | number
  sid?: string | number
  // Some EasyParcel accounts expect `courier` as the selected courier identifier
  courier?: string | number
  parcel_weight: number
  parcel_width?: number
  parcel_height?: number
  parcel_length?: number
  parcel_content: string
  parcel_value: number
  reference_1?: string // Order ID
  reference_2?: string // Fulfillment ID
  
  payment_method?: string // "COD" or "CREDIT"
  cod_amount?: number
  insurance?: number
}

export type EasyParcelSubmitOrderRequest = {
  bulk: EasyParcelOrderItem[]
}

export type EasyParcelSubmitOrderResponse = {
  api_status: EasyParcelApiStatus
  error_code?: number
  error_remark?: string
  result?: Array<{
    status: string
    order_no?: string
    tracking_no?: string
    waybill_no?: string
    courier_name?: string
    service_name?: string
    message?: string
    error_messages?: string[]
    [k: string]: unknown
  }>
  [k: string]: unknown
}

// Payment Types
export type EasyParcelPaymentRequest = {
  order_nos: string[] // Array of order numbers to pay
}

export type EasyParcelPaymentResponse = {
  api_status: EasyParcelApiStatus
  error_code?: number
  error_remark?: string
  payment?: {
    status: string
    message?: string
    receipt_no?: string
    total_amount?: number
    [k: string]: unknown
  }
  [k: string]: unknown
}


