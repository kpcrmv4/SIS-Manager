export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          actor_name: string | null
          at: string
          branch_id: string | null
          category: string
          details: Json
          id: number
          target: string | null
          target_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind?: string
          actor_name?: string | null
          at?: string
          branch_id?: string | null
          category: string
          details?: Json
          id?: never
          target?: string | null
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          actor_name?: string | null
          at?: string
          branch_id?: string | null
          category?: string
          details?: Json
          id?: never
          target?: string | null
          target_id?: string | null
        }
        Relationships: []
      }
      booking_blackouts: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          night: string
          reason: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          night: string
          reason?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          night?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_blackouts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_blackouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settings: {
        Row: {
          advance_days: number
          auto_confirm: boolean
          branch_id: string
          closed_weekdays: number[]
          customer_cancel_hours: number
          cutoff_time: string
          line_enabled: boolean
          max_bookings_per_night: number | null
          no_show_minutes: number
          party_max: number
          party_min: number
          slot_end: string
          slot_minutes: number
          slot_start: string
          table_choice: string
          updated_at: string
        }
        Insert: {
          advance_days?: number
          auto_confirm?: boolean
          branch_id: string
          closed_weekdays?: number[]
          customer_cancel_hours?: number
          cutoff_time?: string
          line_enabled?: boolean
          max_bookings_per_night?: number | null
          no_show_minutes?: number
          party_max?: number
          party_min?: number
          slot_end?: string
          slot_minutes?: number
          slot_start?: string
          table_choice?: string
          updated_at?: string
        }
        Update: {
          advance_days?: number
          auto_confirm?: boolean
          branch_id?: string
          closed_weekdays?: number[]
          customer_cancel_hours?: number
          cutoff_time?: string
          line_enabled?: boolean
          max_bookings_per_night?: number | null
          no_show_minutes?: number
          party_max?: number
          party_min?: number
          slot_end?: string
          slot_minutes?: number
          slot_start?: string
          table_choice?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          arrived_at: string | null
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by_customer: boolean
          checked_in_by: string | null
          code: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          name: string
          night: string
          no_show_at: string | null
          note: string | null
          party_size: number
          phone: string | null
          qr_token: string
          reject_reason: string | null
          rejected_at: string | null
          reminder_sent_at: string | null
          slot_time: string
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["booking_status"]
          table_id: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          arrived_at?: string | null
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_customer?: boolean
          checked_in_by?: string | null
          code: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          name: string
          night: string
          no_show_at?: string | null
          note?: string | null
          party_size: number
          phone?: string | null
          qr_token?: string
          reject_reason?: string | null
          rejected_at?: string | null
          reminder_sent_at?: string | null
          slot_time: string
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["booking_status"]
          table_id?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          arrived_at?: string | null
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_customer?: boolean
          checked_in_by?: string | null
          code?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          name?: string
          night?: string
          no_show_at?: string | null
          note?: string | null
          party_size?: number
          phone?: string | null
          qr_token?: string
          reject_reason?: string | null
          rejected_at?: string | null
          reminder_sent_at?: string | null
          slot_time?: string
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          table_id?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_line_secrets: {
        Row: {
          branch_id: string
          channel_access_token: string | null
          channel_secret: string | null
          group_bind_code: string | null
          group_bind_expires_at: string | null
          group_bind_failures: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          channel_access_token?: string | null
          channel_secret?: string | null
          group_bind_code?: string | null
          group_bind_expires_at?: string | null
          group_bind_failures?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          channel_access_token?: string | null
          channel_secret?: string | null
          group_bind_code?: string | null
          group_bind_expires_at?: string | null
          group_bind_failures?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_line_secrets_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          closes_at: string
          code: string
          created_at: string
          deposit_days: number
          expiry_notice_days: number
          expiry_reminder_days: number[]
          expiry_reminder_templates: Json
          expiry_reminder_time: string
          expiry_reminders_enabled: boolean
          id: string
          liff_id: string | null
          line_bot_user_id: string | null
          line_channel_id: string | null
          name: string
          opens_at: string
          phone: string | null
          print_server_printer_name: string | null
          print_server_working_hours: Json | null
          receipt_settings: Json
          sort: number
          staff_group_id: string | null
          updated_at: string
          withdrawal_blocked_days: string[]
        }
        Insert: {
          active?: boolean
          closes_at?: string
          code: string
          created_at?: string
          deposit_days?: number
          expiry_notice_days?: number
          expiry_reminder_days?: number[]
          expiry_reminder_templates?: Json
          expiry_reminder_time?: string
          expiry_reminders_enabled?: boolean
          id?: string
          liff_id?: string | null
          line_bot_user_id?: string | null
          line_channel_id?: string | null
          name: string
          opens_at?: string
          phone?: string | null
          print_server_printer_name?: string | null
          print_server_working_hours?: Json | null
          receipt_settings?: Json
          sort?: number
          staff_group_id?: string | null
          updated_at?: string
          withdrawal_blocked_days?: string[]
        }
        Update: {
          active?: boolean
          closes_at?: string
          code?: string
          created_at?: string
          deposit_days?: number
          expiry_notice_days?: number
          expiry_reminder_days?: number[]
          expiry_reminder_templates?: Json
          expiry_reminder_time?: string
          expiry_reminders_enabled?: boolean
          id?: string
          liff_id?: string | null
          line_bot_user_id?: string | null
          line_channel_id?: string | null
          name?: string
          opens_at?: string
          phone?: string | null
          print_server_printer_name?: string | null
          print_server_working_hours?: Json | null
          receipt_settings?: Json
          sort?: number
          staff_group_id?: string | null
          updated_at?: string
          withdrawal_blocked_days?: string[]
        }
        Relationships: []
      }
      customer_vips: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          phone_key: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          phone_key?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          phone_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_vips_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_vips_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_vips_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          display_name: string | null
          expiry_notices_enabled: boolean
          id: string
          line_user_id: string
          locale: Database["public"]["Enums"]["app_locale"]
          phone: string | null
          picture_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          expiry_notices_enabled?: boolean
          id?: string
          line_user_id: string
          locale?: Database["public"]["Enums"]["app_locale"]
          phone?: string | null
          picture_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          expiry_notices_enabled?: boolean
          id?: string
          line_user_id?: string
          locale?: Database["public"]["Enums"]["app_locale"]
          phone?: string | null
          picture_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deposit_bottles: {
        Row: {
          bottle_no: number
          consumed_at: string | null
          consumed_by: string | null
          deposit_id: string
          id: string
          remaining_percent: number
          status: Database["public"]["Enums"]["bottle_status"]
          updated_at: string
        }
        Insert: {
          bottle_no: number
          consumed_at?: string | null
          consumed_by?: string | null
          deposit_id: string
          id?: string
          remaining_percent?: number
          status?: Database["public"]["Enums"]["bottle_status"]
          updated_at?: string
        }
        Update: {
          bottle_no?: number
          consumed_at?: string | null
          consumed_by?: string | null
          deposit_id?: string
          id?: string
          remaining_percent?: number
          status?: Database["public"]["Enums"]["bottle_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_bottles_consumed_by_fkey"
            columns: ["consumed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_bottles_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          branch_id: string
          created_at: string
          deposit_id: string
          id: number
          payload: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind?: string
          branch_id: string
          created_at?: string
          deposit_id: string
          id?: never
          payload?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          branch_id?: string
          created_at?: string
          deposit_id?: string
          id?: never
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deposit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_events_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string
          code: string
          collect_deadline_at: string | null
          confirm_photo_paths: string[]
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          dispose_reason: string | null
          disposed_at: string | null
          disposed_by: string | null
          expired_notice_sent_at: string | null
          expires_at: string | null
          expiry_notice_sent_at: string | null
          expiry_reminders_sent: number[]
          id: string
          is_vip: boolean
          item_id: string | null
          item_name: string
          link_code: string
          link_token: string
          notes: string | null
          photo_paths: string[]
          quantity: number
          received_at: string | null
          received_by: string | null
          remaining_percent: number
          remaining_qty: number
          source: string
          status: Database["public"]["Enums"]["deposit_status"]
          table_label: string | null
          terms_accepted_at: string | null
          terms_locale: Database["public"]["Enums"]["app_locale"] | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string
          code: string
          collect_deadline_at?: string | null
          confirm_photo_paths?: string[]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          dispose_reason?: string | null
          disposed_at?: string | null
          disposed_by?: string | null
          expired_notice_sent_at?: string | null
          expires_at?: string | null
          expiry_notice_sent_at?: string | null
          expiry_reminders_sent?: number[]
          id?: string
          is_vip?: boolean
          item_id?: string | null
          item_name: string
          link_code?: string
          link_token?: string
          notes?: string | null
          photo_paths?: string[]
          quantity: number
          received_at?: string | null
          received_by?: string | null
          remaining_percent?: number
          remaining_qty?: number
          source?: string
          status: Database["public"]["Enums"]["deposit_status"]
          table_label?: string | null
          terms_accepted_at?: string | null
          terms_locale?: Database["public"]["Enums"]["app_locale"] | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string
          code?: string
          collect_deadline_at?: string | null
          confirm_photo_paths?: string[]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          dispose_reason?: string | null
          disposed_at?: string | null
          disposed_by?: string | null
          expired_notice_sent_at?: string | null
          expires_at?: string | null
          expiry_notice_sent_at?: string | null
          expiry_reminders_sent?: number[]
          id?: string
          is_vip?: boolean
          item_id?: string | null
          item_name?: string
          link_code?: string
          link_token?: string
          notes?: string | null
          photo_paths?: string[]
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          remaining_percent?: number
          remaining_qty?: number
          source?: string
          status?: Database["public"]["Enums"]["deposit_status"]
          table_label?: string | null
          terms_accepted_at?: string | null
          terms_locale?: Database["public"]["Enums"]["app_locale"] | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_disposed_by_fkey"
            columns: ["disposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "liquor_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      line_link_failures: {
        Row: {
          branch_id: string
          created_at: string
          id: number
          line_user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: never
          line_user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: never
          line_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_link_failures_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      line_outbox: {
        Row: {
          attempts: number
          branch_id: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          kind: string
          locale: Database["public"]["Enums"]["app_locale"]
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: Database["public"]["Enums"]["outbox_status"]
          target: string
          target_kind: string
        }
        Insert: {
          attempts?: number
          branch_id: string
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: string
          kind: string
          locale?: Database["public"]["Enums"]["app_locale"]
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
          target: string
          target_kind: string
        }
        Update: {
          attempts?: number
          branch_id?: string
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: string
          kind?: string
          locale?: Database["public"]["Enums"]["app_locale"]
          next_attempt_at?: string
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["outbox_status"]
          target?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_outbox_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      liquor_items: {
        Row: {
          active: boolean
          branch_id: string | null
          category: string
          created_at: string
          id: string
          name: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          category?: string
          created_at?: string
          id?: string
          name: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          category?: string
          created_at?: string
          id?: string
          name?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liquor_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          payload: Json
          pushed_at: string | null
          read_at: string | null
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          payload?: Json
          pushed_at?: string | null
          read_at?: string | null
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          payload?: Json
          pushed_at?: string | null
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          attempts: number
          branch_id: string
          copies: number
          created_at: string
          deposit_id: string | null
          error_message: string | null
          id: string
          job_type: string
          payload: Json
          printed_at: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["print_status"]
        }
        Insert: {
          attempts?: number
          branch_id: string
          copies?: number
          created_at?: string
          deposit_id?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          payload?: Json
          printed_at?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["print_status"]
        }
        Update: {
          attempts?: number
          branch_id?: string
          copies?: number
          created_at?: string
          deposit_id?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          payload?: Json
          printed_at?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["print_status"]
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      print_stations: {
        Row: {
          account_id: string | null
          branch_id: string
          created_at: string
          error_message: string | null
          hostname: string | null
          id: string
          is_online: boolean
          last_heartbeat: string | null
          name: string
          printer_name: string | null
          printer_status: string | null
          server_version: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          branch_id: string
          created_at?: string
          error_message?: string | null
          hostname?: string | null
          id?: string
          is_online?: boolean
          last_heartbeat?: string | null
          name?: string
          printer_name?: string | null
          printer_status?: string | null
          server_version?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          branch_id?: string
          created_at?: string
          error_message?: string | null
          hostname?: string | null
          id?: string
          is_online?: boolean
          last_heartbeat?: string | null
          name?: string
          printer_name?: string | null
          printer_status?: string | null
          server_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_stations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          id: string
          locale: Database["public"]["Enums"]["app_locale"]
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string
          id: string
          locale?: Database["public"]["Enums"]["app_locale"]
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          id?: string
          locale?: Database["public"]["Enums"]["app_locale"]
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      table_blocks: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          night: string
          table_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          night: string
          table_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          night?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_blocks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_blocks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_blocks_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      table_zones: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          customer_bookable: boolean
          id: string
          name: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          customer_bookable?: boolean
          id?: string
          name: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          customer_bookable?: boolean
          id?: string
          name?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_zones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          customer_bookable: boolean
          id: string
          label: string
          seats_max: number
          seats_min: number
          shape: string
          sort: number
          updated_at: string
          zone_id: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          customer_bookable?: boolean
          id?: string
          label: string
          seats_max?: number
          seats_min?: number
          shape?: string
          sort?: number
          updated_at?: string
          zone_id: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          customer_bookable?: boolean
          id?: string
          label?: string
          seats_max?: number
          seats_min?: number
          shape?: string
          sort?: number
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tables_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "table_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branches: {
        Row: {
          branch_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          bottle_id: string | null
          branch_id: string
          by_customer: boolean
          created_at: string
          customer_id: string | null
          deposit_id: string
          id: string
          notes: string | null
          photo_path: string | null
          processed_at: string | null
          processed_by: string | null
          qty: number
          reject_reason: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          table_label: string | null
          type: Database["public"]["Enums"]["withdrawal_type"]
        }
        Insert: {
          bottle_id?: string | null
          branch_id: string
          by_customer?: boolean
          created_at?: string
          customer_id?: string | null
          deposit_id: string
          id?: string
          notes?: string | null
          photo_path?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qty?: number
          reject_reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          table_label?: string | null
          type?: Database["public"]["Enums"]["withdrawal_type"]
        }
        Update: {
          bottle_id?: string | null
          branch_id?: string
          by_customer?: boolean
          created_at?: string
          customer_id?: string | null
          deposit_id?: string
          id?: string
          notes?: string | null
          photo_path?: string | null
          processed_at?: string | null
          processed_by?: string | null
          qty?: number
          reject_reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          table_label?: string | null
          type?: Database["public"]["Enums"]["withdrawal_type"]
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "deposit_bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_table: {
        Args: { p_booking: string; p_table: string }
        Returns: Json
      }
      audit_feed: {
        Args: {
          p_actor?: string
          p_branch?: string
          p_category?: string
          p_from: string
          p_limit?: number
          p_offset?: number
          p_q?: string
          p_to: string
        }
        Returns: Json
      }
      bind_staff_group: {
        Args: { p_branch: string; p_code: string; p_group_id: string }
        Returns: boolean
      }
      booking_availability: {
        Args: { p_branch: string; p_from: string; p_to: string }
        Returns: Json
      }
      cancel_booking: {
        Args: {
          p_booking: string
          p_branch?: string
          p_customer_id?: string
          p_reason?: string
        }
        Returns: Json
      }
      check_in_booking: {
        Args: { p_branch: string; p_ref: string }
        Returns: Json
      }
      claim_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          branch_id: string
          created_at: string
          dedupe_key: string
          error: string | null
          id: string
          kind: string
          locale: Database["public"]["Enums"]["app_locale"]
          next_attempt_at: string
          payload: Json
          sent_at: string | null
          status: Database["public"]["Enums"]["outbox_status"]
          target: string
          target_kind: string
        }[]
        SetofOptions: {
          from: "*"
          to: "line_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_push: {
        Args: { p_limit?: number }
        Returns: {
          auth: string
          endpoint: string
          kind: string
          link: string
          notification_id: string
          p256dh: string
          payload: Json
          subscription_id: string
          user_id: string
        }[]
      }
      complete_withdrawals: {
        Args: {
          p_notes?: string
          p_photo_path?: string
          p_withdrawal_ids: string[]
        }
        Returns: Json
      }
      confirm_booking: {
        Args: { p_booking: string; p_table?: string }
        Returns: Json
      }
      confirm_deposit: {
        Args: { p_deposit: string; p_levels: number[]; p_photo_paths: string[] }
        Returns: Json
      }
      create_booking: {
        Args: {
          p_branch: string
          p_customer_id?: string
          p_name: string
          p_night: string
          p_note?: string
          p_party: number
          p_phone?: string
          p_slot: string
          p_table?: string
          p_zone?: string
        }
        Returns: Json
      }
      create_deposit: {
        Args: {
          p_branch: string
          p_category?: string
          p_customer_id?: string
          p_customer_name: string
          p_customer_phone?: string
          p_expires_at?: string
          p_item_id?: string
          p_item_name: string
          p_notes?: string
          p_photo_paths: string[]
          p_quantity: number
          p_table?: string
        }
        Returns: Json
      }
      customer_booking_board: {
        Args: { p_branch: string; p_night: string; p_seq?: string }
        Returns: Json
      }
      customer_detail: {
        Args: {
          p_bk_offset?: number
          p_branch: string
          p_dep_offset?: number
          p_key: string
          p_page?: number
        }
        Returns: Json
      }
      customer_list: {
        Args: {
          p_branch: string
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_q?: string
        }
        Returns: Json
      }
      customer_request_deposit: {
        Args: {
          p_branch: string
          p_customer_id: string
          p_customer_name: string
          p_customer_phone?: string
          p_item_name: string
          p_notes?: string
          p_quantity: number
          p_table?: string
          p_terms_locale: Database["public"]["Enums"]["app_locale"]
          p_terms_version: string
        }
        Returns: Json
      }
      dispose_deposits: {
        Args: { p_deposit_ids: string[]; p_reason?: string }
        Returns: Json
      }
      expire_due_deposits: { Args: never; Returns: number }
      extend_deposit: {
        Args: { p_days: number; p_deposit: string }
        Returns: Json
      }
      finish_outbox: {
        Args: {
          p_error?: string
          p_id: string
          p_status: Database["public"]["Enums"]["outbox_status"]
        }
        Returns: undefined
      }
      line_link_attempt: {
        Args: { p_branch: string; p_customer_id: string; p_ref: string }
        Returns: Json
      }
      link_deposit_customer: {
        Args: { p_branch: string; p_customer_id: string; p_token: string }
        Returns: Json
      }
      login_record: {
        Args: { p_identifier: string; p_ip: string; p_ok: boolean }
        Returns: undefined
      }
      login_throttle: {
        Args: { p_identifier: string; p_ip: string }
        Returns: boolean
      }
      mark_booking_no_show: { Args: { p_booking: string }; Returns: Json }
      mark_no_shows: { Args: never; Returns: number }
      new_group_bind_code: { Args: { p_branch: string }; Returns: Json }
      owner_dashboard: { Args: never; Returns: Json }
      owner_overview: { Args: { p_from: string; p_to: string }; Returns: Json }
      owner_report: {
        Args: { p_branch?: string; p_from: string; p_to: string }
        Returns: Json
      }
      owner_report_detail: {
        Args: { p_branch?: string; p_from: string; p_to: string }
        Returns: Json
      }
      owner_trends: {
        Args: {
          p_from: string
          p_prev_from: string
          p_prev_to: string
          p_to: string
        }
        Returns: Json
      }
      queue_print: {
        Args: { p_copies?: number; p_deposit: string; p_type: string }
        Returns: Json
      }
      reject_booking: {
        Args: { p_booking: string; p_reason: string }
        Returns: Json
      }
      reject_deposit: {
        Args: { p_deposit: string; p_reason: string }
        Returns: Json
      }
      reject_withdrawal: {
        Args: { p_reason: string; p_withdrawal_ids: string[] }
        Returns: Json
      }
      request_withdrawal: {
        Args: {
          p_bottle_ids: string[]
          p_branch?: string
          p_customer_id?: string
          p_deposit: string
          p_notes?: string
          p_table?: string
          p_type: Database["public"]["Enums"]["withdrawal_type"]
        }
        Returns: Json
      }
      run_expiry_notices: {
        Args: { p_branch?: string; p_force?: boolean }
        Returns: number
      }
      send_booking_reminders: { Args: never; Returns: number }
      send_expiry_notices: { Args: never; Returns: number }
      send_line_test: { Args: { p_branch: string }; Returns: Json }
      set_customer_expiry_notices: {
        Args: { p_deposit: string; p_enabled: boolean }
        Returns: Json
      }
      set_customer_vip: {
        Args: { p_branch: string; p_key: string; p_vip: boolean }
        Returns: Json
      }
      set_vip: { Args: { p_deposit: string; p_vip: boolean }; Returns: Json }
      staff_receive_request: {
        Args: {
          p_customer_phone?: string
          p_deposit: string
          p_item_id?: string
          p_item_name?: string
          p_photo_paths: string[]
          p_quantity: number
          p_table?: string
        }
        Returns: Json
      }
      table_availability: {
        Args: { p_branch: string; p_night: string }
        Returns: Json
      }
      unread_counts: {
        Args: { p_users: string[] }
        Returns: {
          unread: number
          user_id: string
        }[]
      }
    }
    Enums: {
      app_locale: "th" | "en" | "zh" | "ko"
      booking_source: "line" | "staff"
      booking_status:
        | "pending"
        | "confirmed"
        | "arrived"
        | "no_show"
        | "cancelled"
        | "rejected"
      bottle_status: "sealed" | "opened" | "consumed"
      deposit_status:
        | "requested"
        | "pending_confirm"
        | "in_store"
        | "pending_withdrawal"
        | "withdrawn"
        | "expired"
        | "disposed"
        | "cancelled"
      outbox_status: "queued" | "sending" | "sent" | "failed" | "skipped"
      print_status: "pending" | "printing" | "completed" | "failed"
      user_role: "staff" | "bar" | "owner"
      withdrawal_status: "pending" | "completed" | "rejected" | "cancelled"
      withdrawal_type: "in_store" | "take_home"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_locale: ["th", "en", "zh", "ko"],
      booking_source: ["line", "staff"],
      booking_status: [
        "pending",
        "confirmed",
        "arrived",
        "no_show",
        "cancelled",
        "rejected",
      ],
      bottle_status: ["sealed", "opened", "consumed"],
      deposit_status: [
        "requested",
        "pending_confirm",
        "in_store",
        "pending_withdrawal",
        "withdrawn",
        "expired",
        "disposed",
        "cancelled",
      ],
      outbox_status: ["queued", "sending", "sent", "failed", "skipped"],
      print_status: ["pending", "printing", "completed", "failed"],
      user_role: ["staff", "bar", "owner"],
      withdrawal_status: ["pending", "completed", "rejected", "cancelled"],
      withdrawal_type: ["in_store", "take_home"],
    },
  },
} as const
