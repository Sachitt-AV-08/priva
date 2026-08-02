from pydantic import BaseModel
from typing import Optional

class Product(BaseModel):
    id: str
    title: str
    price: float
    currency: str = "USD"
    merchant: str
    merchant_url: str = ""
    rating: Optional[float] = None
    reviews: Optional[int] = None
    thumbnail: str = ""
    product_url: str = ""
    is_used: bool = False
    trust: int = 0
    over_budget: bool = False

class Transaction(BaseModel):
    id: str
    user_id: str = "default"
    product_id: str
    product_title: str
    merchant: str
    amount: float
    currency: str = "USD"
    status: str = "pending"
    prava_session_id: str = ""
    prava_status: str = ""
    order_id: str = ""
    thumbnail: str = ""
    product_url: str = ""
    shipping_status: str = ""
    shipping_eta: str = ""
    note_id: str = ""
    created_at: int = 0

class Intent(BaseModel):
    action: str
    query: str = ""
    max_price: Optional[float] = None
    category: str = ""
    quantity: int = 1

class IncomingMessage(BaseModel):
    from_: str
    text: str
    thread_id: str = ""

class OutgoingMessage(BaseModel):
    to: str
    text: str
    thread_id: str = ""
