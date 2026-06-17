# Sample Rails schema.rb fixture for claude-db detection/parse tests.
ActiveRecord::Schema[7.1].define(version: 2026_01_14_000007) do
  create_table "customers", force: :cascade do |t|
    t.string "email", null: false
    t.datetime "created_at", null: false
    t.index ["email"], name: "index_customers_on_email", unique: true
  end

  create_table "orders", force: :cascade do |t|
    t.bigint "customer_id", null: false
    t.decimal "amount", precision: 12, scale: 2, null: false
    t.string "status", default: "pending", null: false
    t.datetime "created_at", null: false
    # NOTE: no index on customer_id — claude-db M11 should flag the unindexed FK.
  end

  add_foreign_key "orders", "customers"
end
