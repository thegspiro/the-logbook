"""
Storefront API Endpoints

Member-facing store (browse the open window, place an order, track it) and the
administrative side (catalog, order windows, order management, payment
reconciliation, exports).

Permissions
-----------
``storefront.view``   — browse the store and manage your own orders
``storefront.order``  — place orders
``storefront.manage`` — catalog, windows, other members' orders, settings
"""

from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi import File as FastAPIFile
from fastapi import HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.storefront import (
    StoreOrder,
    StoreOrderWindow,
    StorePaymentStatus,
    StoreProduct,
    StoreSettings,
)
from app.models.user import User
from app.schemas.storefront import (
    StoreBulkPayment,
    StoreBulkStatusResult,
    StoreBulkStatusUpdate,
    StoreDashboardResponse,
    StorefrontResponse,
    StoreNotificationPreviewResponse,
    StoreNotificationTestResponse,
    StoreOrderAdminNotes,
    StoreOrderCancel,
    StoreOrderCreate,
    StoreOrderListResponse,
    StoreOrderMarkPaid,
    StoreOrderMessage,
    StoreOrderPaymentRecord,
    StoreOrderPaymentReport,
    StoreOrderRefund,
    StoreOrderResponse,
    StoreOrderStatusUpdate,
    StoreOrderWaive,
    StoreOrderWindowCreate,
    StoreOrderWindowResponse,
    StoreOrderWindowUpdate,
    StorePaymentEventApply,
    StorePaymentEventIgnore,
    StorePaymentEventListResponse,
    StorePaymentEventResponse,
    StoreProductCreate,
    StoreProductResponse,
    StoreProductUpdate,
    StoreSettingsResponse,
    StoreSettingsUpdate,
    StoreVendorOrderRequest,
    StoreVendorOrderResult,
    StoreWindowCloseRequest,
    StoreWindowOpenRequest,
    StoreWindowSummaryResponse,
)
from app.services.storefront_preview_service import (
    PreviewNotAvailable,
    StorefrontPreviewService,
)
from app.services.storefront_service import StorefrontService
from app.utils.image_processing import optimize_image

router = APIRouter()

# Product photos are re-encoded before storage, so this bounds the *upload*,
# not what ends up in the database.
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}


def _detect_image_mime(contents: bytes) -> str:
    """Identify an image by magic bytes.

    A client-supplied Content-Type is not evidence of anything; sniffing the
    header is what stops a renamed executable from being stored and served
    back to members.
    """
    try:
        import magic

        return magic.from_buffer(contents, mime=True)
    except Exception:
        # libmagic is optional in some deployments; fall back to signatures.
        if contents[:8] == b"\x89PNG\r\n\x1a\n":
            return "image/png"
        if contents[:2] == b"\xff\xd8":
            return "image/jpeg"
        if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
            return "image/webp"
        return "unknown"


# ==========================================================================
# Serialization helpers
# ==========================================================================


def _order_payload(
    order: StoreOrder,
    service: StorefrontService,
    settings: StoreSettings,
    include_internal: bool,
) -> Dict[str, Any]:
    """Shape one order for the API, hiding internal fields from members."""
    total = Decimal(order.total or 0)
    paid = Decimal(order.amount_paid or 0)
    balance_due = (
        Decimal("0")
        if order.payment_status == StorePaymentStatus.WAIVED
        else max(total - paid, Decimal("0"))
    )

    events = []
    for event in order.events:
        if not include_internal and not event.is_member_visible:
            continue
        author = getattr(event, "author", None)
        events.append(
            {
                "id": event.id,
                "event_type": event.event_type,
                "from_status": event.from_status,
                "to_status": event.to_status,
                "message": event.message,
                "is_member_visible": event.is_member_visible,
                "author_name": author.full_name if author else None,
                "created_at": event.created_at,
            }
        )

    return {
        "id": order.id,
        "organization_id": order.organization_id,
        "window_id": order.window_id,
        "window_name": order.window.name if order.window else None,
        "user_id": order.user_id,
        "order_number": order.order_number,
        "customer_name": order.customer_name,
        "customer_email": order.customer_email,
        "customer_phone": order.customer_phone,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "subtotal": order.subtotal,
        "tax_amount": order.tax_amount,
        "shipping_amount": order.shipping_amount,
        "discount_amount": order.discount_amount,
        "total": order.total,
        "amount_paid": order.amount_paid,
        "balance_due": balance_due,
        "payment_reference": order.payment_reference,
        "payment_reported_at": order.payment_reported_at,
        "paid_at": order.paid_at,
        "fulfillment_method": order.fulfillment_method,
        "shipping_address": order.shipping_address,
        "member_notes": order.member_notes,
        "admin_notes": order.admin_notes if include_internal else None,
        "submitted_at": order.submitted_at,
        "cancelled_at": order.cancelled_at,
        "cancellation_reason": order.cancellation_reason,
        "fulfilled_at": order.fulfilled_at,
        "items": order.items,
        "events": events,
        "payment_instructions": service.build_payment_instructions(order, settings),
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def _window_payload(
    window: StoreOrderWindow,
    order_count: int = 0,
    total_sales: Decimal = Decimal("0"),
    outstanding: Decimal = Decimal("0"),
) -> Dict[str, Any]:
    return {
        "id": window.id,
        "organization_id": window.organization_id,
        "name": window.name,
        "description": window.description,
        "status": window.status,
        "opens_at": window.opens_at,
        "closes_at": window.closes_at,
        "auto_open": window.auto_open,
        "auto_close": window.auto_close,
        "expected_delivery_date": window.expected_delivery_date,
        "pickup_instructions": window.pickup_instructions,
        "include_all_products": window.include_all_products,
        "notify_on_open": window.notify_on_open,
        "opened_at": window.opened_at,
        "closed_at": window.closed_at,
        "cancelled_at": window.cancelled_at,
        "notes": window.notes,
        "order_count": order_count,
        "total_sales": total_sales,
        "outstanding_balance": outstanding,
        "offerings": [
            {
                "id": offering.id,
                "product_id": offering.product_id,
                "product_name": (offering.product.name if offering.product else None),
                "price_override": offering.price_override,
                "quantity_limit": offering.quantity_limit,
                "max_per_member": offering.max_per_member,
                "sort_order": offering.sort_order,
            }
            for offering in sorted(window.offerings, key=lambda o: o.sort_order)
        ],
        "created_at": window.created_at,
        "updated_at": window.updated_at,
    }


def _window_summary(window: StoreOrderWindow) -> Dict[str, Any]:
    """The shopper-facing subset of an order window (no internal fields)."""
    return {
        "id": window.id,
        "name": window.name,
        "description": window.description,
        "closes_at": window.closes_at,
        "expected_delivery_date": window.expected_delivery_date,
        "pickup_instructions": window.pickup_instructions,
    }


def _product_payload(product: StoreProduct, has_image: bool = False) -> Dict[str, Any]:
    return {
        "image_url": StorefrontService.resolve_image_url(product, has_image),
        "has_image": has_image,
        **{
            field: getattr(product, field)
            for field in (
                "id",
                "organization_id",
                "name",
                "sku",
                "description",
                "category",
                "inventory_item_id",
                "price",
                "cost",
                "is_taxable",
                "status",
                "max_per_member",
                "track_stock",
                "stock_quantity",
                "requires_variant",
                "personalization_enabled",
                "personalization_required",
                "personalization_label",
                "personalization_max_length",
                "personalization_price",
                "sort_order",
                "internal_notes",
                "created_at",
                "updated_at",
            )
        },
        "variants": sorted(product.variants, key=lambda v: v.sort_order),
    }


# ==========================================================================
# Member-facing store
# ==========================================================================


@router.get("/storefront", response_model=StorefrontResponse)
async def get_storefront(
    window_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """Everything needed to render the member-facing store."""
    service = StorefrontService(db)
    try:
        data = await service.get_storefront(
            str(current_user.organization_id),
            user_id=str(current_user.id),
            window_id=window_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    settings = data["settings"]
    window = data["window"]
    return {
        "is_enabled": settings.is_enabled,
        "store_name": settings.store_name,
        "tagline": settings.tagline,
        "description": settings.description,
        "currency": settings.currency,
        "terms_text": settings.terms_text,
        "allow_pickup": settings.allow_pickup,
        "allow_shipping": settings.allow_shipping,
        "pickup_location": settings.pickup_location,
        "shipping_flat_rate": settings.shipping_flat_rate,
        "tax_rate": settings.tax_rate,
        "accepted_payment_methods": settings.accepted_payment_methods or [],
        "payment_instructions": settings.payment_instructions,
        "window": _window_summary(window) if window else None,
        "other_open_windows": [
            _window_summary(other) for other in data["other_open_windows"]
        ],
        "products": data["products"],
    }


@router.post(
    "/orders", response_model=StoreOrderResponse, status_code=status.HTTP_201_CREATED
)
async def create_order(
    payload: StoreOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.order")),
) -> Any:
    """Place an order against the open window."""
    service = StorefrontService(db)
    try:
        order = await service.create_order(
            str(current_user.organization_id),
            current_user,
            payload.model_dump(exclude_unset=False),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=safe_error_detail(exc))

    settings = await service.get_settings(str(current_user.organization_id))
    await log_audit_event(
        db=db,
        event_type="store_order_created",
        event_category="storefront",
        severity="info",
        event_data={
            "order_id": str(order.id),
            "order_number": order.order_number,
            "total": str(order.total),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _order_payload(order, service, settings, include_internal=False)


@router.get("/orders/mine", response_model=List[StoreOrderResponse])
async def list_my_orders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """The signed-in member's own order history."""
    service = StorefrontService(db)
    orders, _ = await service.list_orders(
        str(current_user.organization_id),
        user_id=str(current_user.id),
        page=1,
        page_size=100,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return [
        _order_payload(order, service, settings, include_internal=False)
        for order in orders
    ]


@router.get("/orders/mine/{order_id}", response_model=StoreOrderResponse)
async def get_my_order(
    order_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """One of the member's own orders."""
    service = StorefrontService(db)
    order = await service.get_order(
        order_id,
        str(current_user.organization_id),
        user_id=str(current_user.id),
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=False)


@router.post(
    "/orders/mine/{order_id}/report-payment", response_model=StoreOrderResponse
)
async def report_payment(
    order_id: str,
    payload: StoreOrderPaymentReport,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """Member tells the department they have sent payment (awaits verification)."""
    service = StorefrontService(db)
    try:
        order = await service.report_payment(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            payload.payment_method,
            reference=payload.reference,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=False)


@router.post("/orders/mine/{order_id}/cancel", response_model=StoreOrderResponse)
async def cancel_my_order(
    order_id: str,
    payload: StoreOrderCancel,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """Cancel one's own order while it is still unfulfilled."""
    service = StorefrontService(db)
    try:
        order = await service.cancel_order(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            reason=payload.reason,
            notify_member=False,
            user_id=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=False)


# ==========================================================================
# Settings
# ==========================================================================


@router.get("/settings", response_model=StoreSettingsResponse)
async def get_store_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Store configuration for administrators."""
    service = StorefrontService(db)
    return await service.get_settings(str(current_user.organization_id))


@router.put("/settings", response_model=StoreSettingsResponse)
async def update_store_settings(
    payload: StoreSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Update store configuration (payment handles, notices, pricing rules)."""
    service = StorefrontService(db)
    try:
        settings = await service.update_settings(
            str(current_user.organization_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_settings_updated",
        event_category="storefront",
        severity="info",
        event_data={
            "settings_id": str(settings.id),
            "is_enabled": settings.is_enabled,
            "fields_updated": list(payload.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return settings


@router.get(
    "/settings/notifications/{notice}/preview",
    response_model=StoreNotificationPreviewResponse,
)
async def preview_store_notification(
    notice: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Render one of the store's notices against a sample order or window.

    The sample data is invented and never written; the payment handles,
    instructions, receipt footer and branding are the department's real saved
    settings, since checking those is the point of looking. Save the settings
    first — the preview reads what is stored, not what is typed on screen.
    """
    try:
        return await StorefrontPreviewService(db).render(
            notice, str(current_user.organization_id)
        )
    except PreviewNotAvailable as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))


@router.post(
    "/settings/notifications/{notice}/test",
    response_model=StoreNotificationTestResponse,
)
async def send_store_notification_test(
    notice: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Mail the previewed notice to your own address.

    Delivery is only ever to the requesting user's own email — this is a way to
    see a notice in a real inbox, not a way to mail the department. The subject
    is prefixed ``[TEST]`` and the body carries a banner, because the sample
    message announces an order number that does not exist.
    """
    if not current_user.email:
        raise HTTPException(
            status_code=400,
            detail="Your account has no email address, so there is nowhere to send it",
        )
    try:
        result = await StorefrontPreviewService(db).send_test(
            notice, str(current_user.organization_id), current_user.email
        )
    except PreviewNotAvailable as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_notification_test_sent",
        event_category="storefront",
        severity="info",
        event_data={
            "notice": notice,
            "delivered": result["delivered"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


# ==========================================================================
# Catalog
# ==========================================================================


@router.get("/products", response_model=List[StoreProductResponse])
async def list_products(
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Catalog listing for administrators."""
    service = StorefrontService(db)
    products = await service.list_products(
        str(current_user.organization_id),
        status=status_filter,
        search=search,
        include_archived=include_archived,
    )
    with_images = await service.products_with_images(
        str(current_user.organization_id), [product.id for product in products]
    )
    return [
        _product_payload(product, product.id in with_images) for product in products
    ]


@router.post(
    "/products",
    response_model=StoreProductResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_product(
    payload: StoreProductCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Add an item to the catalog."""
    service = StorefrontService(db)
    try:
        product = await service.create_product(
            str(current_user.organization_id),
            payload.model_dump(),
            str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _product_payload(
        product,
        bool(
            await service.products_with_images(
                str(current_user.organization_id), [product.id]
            )
        ),
    )


@router.get("/products/{product_id}", response_model=StoreProductResponse)
async def get_product(
    product_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """One catalog item."""
    service = StorefrontService(db)
    product = await service.get_product(product_id, str(current_user.organization_id))
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_payload(
        product,
        bool(
            await service.products_with_images(
                str(current_user.organization_id), [product.id]
            )
        ),
    )


@router.put("/products/{product_id}", response_model=StoreProductResponse)
async def update_product(
    product_id: str,
    payload: StoreProductUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Edit a catalog item and its variants."""
    service = StorefrontService(db)
    try:
        product = await service.update_product(
            product_id,
            str(current_user.organization_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _product_payload(
        product,
        bool(
            await service.products_with_images(
                str(current_user.organization_id), [product.id]
            )
        ),
    )


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_product(
    product_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Response:
    """Archive a catalog item (past orders keep referencing it)."""
    service = StorefrontService(db)
    try:
        await service.archive_product(product_id, str(current_user.organization_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================================================
# Product photos
# ==========================================================================


@router.post("/products/{product_id}/image", response_model=StoreProductResponse)
async def upload_product_image(
    product_id: str,
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Attach a photo to a catalog item.

    The upload is re-encoded to WebP, which strips EXIF (including any GPS
    tag on a phone photo) and bounds the stored size — the bytes are served
    back to every member browsing the store.
    """
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(contents) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Images must be {_MAX_IMAGE_BYTES // (1024 * 1024)}MB or smaller",
        )
    if _detect_image_mime(contents) not in _ALLOWED_IMAGE_MIMES:
        raise HTTPException(
            status_code=400, detail="Invalid image type. Allowed: JPEG, PNG, WebP"
        )

    try:
        optimized = optimize_image(
            contents, max_size=(1200, 1200), quality=82, output_format="WEBP"
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    service = StorefrontService(db)
    try:
        await service.set_product_image(
            product_id,
            str(current_user.organization_id),
            optimized,
            "image/webp",
            str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))

    product = await service.get_product(product_id, str(current_user.organization_id))
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_payload(product, True)


@router.get("/products/{product_id}/image")
async def get_product_image(
    product_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.view")),
) -> Any:
    """Serve a product photo.

    Cached immutably: the URL carries a ``v=`` stamp from the product's
    update time, so a replaced photo arrives under a different URL rather
    than needing a revalidation round trip per image per page load.
    """
    service = StorefrontService(db)
    image = await service.get_product_image(
        product_id, str(current_user.organization_id)
    )
    if image is None:
        raise HTTPException(status_code=404, detail="No image for this product")
    return Response(
        content=image.data,
        media_type=image.content_type or "image/webp",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/products/{product_id}/image", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_image(
    product_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Response:
    """Remove a product photo."""
    service = StorefrontService(db)
    await service.delete_product_image(product_id, str(current_user.organization_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================================================
# Order windows
# ==========================================================================


@router.get("/windows", response_model=List[StoreOrderWindowResponse])
async def list_windows(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """All order windows for the organization."""
    service = StorefrontService(db)
    windows = await service.list_windows(
        str(current_user.organization_id), status=status_filter
    )
    # One grouped query for every window's counters. Calling get_window_summary
    # per window loaded every order of every window to render a few numbers.
    rollups = await service.get_window_rollups(
        str(current_user.organization_id), [window.id for window in windows]
    )
    return [
        _window_payload(
            window,
            order_count=rollups[window.id]["order_count"],
            total_sales=rollups[window.id]["gross_sales"],
            outstanding=rollups[window.id]["outstanding"],
        )
        for window in windows
    ]


@router.post(
    "/windows",
    response_model=StoreOrderWindowResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_window(
    payload: StoreOrderWindowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Create an order window (order period)."""
    service = StorefrontService(db)
    try:
        window = await service.create_window(
            str(current_user.organization_id),
            payload.model_dump(),
            str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _window_payload(window)


@router.get("/windows/{window_id}", response_model=StoreOrderWindowResponse)
async def get_window(
    window_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """One order window with its rollups."""
    service = StorefrontService(db)
    window = await service.get_window(window_id, str(current_user.organization_id))
    if not window:
        raise HTTPException(status_code=404, detail="Order window not found")
    summary = await service.get_window_summary(
        window_id, str(current_user.organization_id)
    )
    return _window_payload(
        window,
        order_count=summary["order_count"],
        total_sales=summary["gross_sales"],
        outstanding=summary["outstanding"],
    )


@router.put("/windows/{window_id}", response_model=StoreOrderWindowResponse)
async def update_window(
    window_id: str,
    payload: StoreOrderWindowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Edit an order window."""
    service = StorefrontService(db)
    try:
        window = await service.update_window(
            window_id,
            str(current_user.organization_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _window_payload(window)


@router.post("/windows/{window_id}/open", response_model=StoreOrderWindowResponse)
async def open_window(
    window_id: str,
    payload: StoreWindowOpenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Open the window for ordering and (optionally) announce it."""
    service = StorefrontService(db)
    try:
        window = await service.open_window(
            window_id,
            str(current_user.organization_id),
            notify_members=payload.notify_members,
            message=payload.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_window_opened",
        event_category="storefront",
        severity="info",
        event_data={
            "window_id": str(window.id),
            "name": window.name,
            "notified": payload.notify_members,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _window_payload(window)


@router.post("/windows/{window_id}/close", response_model=StoreOrderWindowResponse)
async def close_window(
    window_id: str,
    payload: StoreWindowCloseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Close the window and tell everyone who ordered what happens next."""
    service = StorefrontService(db)
    try:
        window = await service.close_window(
            window_id,
            str(current_user.organization_id),
            notify_members=payload.notify_members,
            message=payload.message,
            closed_by=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_window_closed",
        event_category="storefront",
        severity="info",
        event_data={
            "window_id": str(window.id),
            "name": window.name,
            "notified": payload.notify_members,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _window_payload(window)


@router.post("/windows/{window_id}/cancel", response_model=StoreOrderWindowResponse)
async def cancel_window(
    window_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Cancel an order window."""
    from app.models.storefront import StoreWindowStatus

    service = StorefrontService(db)
    try:
        window = await service.set_window_status(
            window_id, str(current_user.organization_id), StoreWindowStatus.CANCELLED
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _window_payload(window)


@router.post("/windows/{window_id}/fulfill", response_model=StoreOrderWindowResponse)
async def mark_window_fulfilled(
    window_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Mark a closed window as fully distributed."""
    from app.models.storefront import StoreWindowStatus

    service = StorefrontService(db)
    try:
        window = await service.set_window_status(
            window_id, str(current_user.organization_id), StoreWindowStatus.FULFILLED
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return _window_payload(window)


@router.delete("/windows/{window_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_window(
    window_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Response:
    """Delete a window that never took an order."""
    service = StorefrontService(db)
    try:
        await service.delete_window(window_id, str(current_user.organization_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/windows/{window_id}/vendor-order", response_model=StoreVendorOrderResult)
async def record_vendor_order(
    window_id: str,
    payload: StoreVendorOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Log that the bulk order went to the vendor, and advance the orders."""
    service = StorefrontService(db)
    try:
        result = await service.record_vendor_order(
            window_id,
            str(current_user.organization_id),
            str(current_user.id),
            vendor_name=payload.vendor_name,
            vendor_reference=payload.vendor_reference,
            expected_delivery_date=payload.expected_delivery_date,
            advance_orders=payload.advance_orders,
            notify_members=payload.notify_members,
            message=payload.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    await log_audit_event(
        db=db,
        event_type="store_vendor_order_recorded",
        event_category="storefront",
        severity="info",
        event_data={
            "window_id": window_id,
            "vendor_name": payload.vendor_name,
            "vendor_reference": payload.vendor_reference,
            "orders_advanced": result["advanced"],
            "orders_skipped": len(result["skipped"]),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


@router.get("/windows/{window_id}/summary", response_model=StoreWindowSummaryResponse)
async def get_window_summary(
    window_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Bulk-purchase tally and money rollup for one window."""
    service = StorefrontService(db)
    try:
        return await service.get_window_summary(
            window_id, str(current_user.organization_id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))


# ==========================================================================
# Order administration
# ==========================================================================


@router.get("/dashboard", response_model=StoreDashboardResponse)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Landing-page rollup for store administrators."""
    service = StorefrontService(db)
    data = await service.get_dashboard(str(current_user.organization_id))
    settings = await service.get_settings(str(current_user.organization_id))
    active_window = data["active_window"]
    return {
        **data,
        "active_window": _window_payload(active_window) if active_window else None,
        "recent_orders": [
            _order_payload(order, service, settings, include_internal=True)
            for order in data["recent_orders"]
        ],
    }


@router.get("/orders", response_model=StoreOrderListResponse)
async def list_orders(
    window_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    payment_status: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Paged order list for administrators."""
    service = StorefrontService(db)
    orders, total = await service.list_orders(
        str(current_user.organization_id),
        window_id=window_id,
        status=status_filter,
        payment_status=payment_status,
        payment_method=payment_method,
        search=search,
        page=page,
        page_size=page_size,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return {
        "items": [
            _order_payload(order, service, settings, include_internal=True)
            for order in orders
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/orders/export")
async def export_orders(
    window_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Line-level CSV export for the vendor order and the treasurer."""
    service = StorefrontService(db)
    content = await service.export_orders_csv(
        str(current_user.organization_id),
        window_id=window_id,
        status=status_filter,
    )
    await log_audit_event(
        db=db,
        event_type="store_orders_exported",
        event_category="storefront",
        severity="info",
        event_data={"window_id": window_id, "status": status_filter},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=store_orders.csv"},
    )


@router.get("/orders/{order_id}", response_model=StoreOrderResponse)
async def get_order(
    order_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """One order, with internal notes."""
    service = StorefrontService(db)
    order = await service.get_order(order_id, str(current_user.organization_id))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/status", response_model=StoreOrderResponse)
async def update_order_status(
    order_id: str,
    payload: StoreOrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Advance an order's fulfillment status and notify the member."""
    service = StorefrontService(db)
    try:
        order = await service.update_order_status(
            order_id,
            str(current_user.organization_id),
            payload.status,
            str(current_user.id),
            message=payload.message,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/payments", response_model=StoreOrderResponse)
async def record_payment(
    order_id: str,
    payload: StoreOrderPaymentRecord,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Record a payment the department has verified receiving."""
    service = StorefrontService(db)
    try:
        order = await service.record_payment(
            order_id,
            str(current_user.organization_id),
            payload.amount,
            str(current_user.id),
            payment_method=payload.payment_method,
            reference=payload.reference,
            mark_paid=payload.mark_paid,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_payment_recorded",
        event_category="storefront",
        severity="info",
        event_data={
            "order_id": str(order_id),
            "amount": str(payload.amount),
            "reference": payload.reference,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/mark-paid", response_model=StoreOrderResponse)
async def mark_order_paid(
    order_id: str,
    payload: StoreOrderMarkPaid,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Settle an order's whole remaining balance in one step.

    The department collects out-of-band (Venmo, cash at drill), so this — not
    a gateway callback — is how an order becomes paid.
    """
    service = StorefrontService(db)
    try:
        order = await service.mark_order_paid(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            payment_method=payload.payment_method,
            reference=payload.reference,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_order_marked_paid",
        event_category="storefront",
        severity="info",
        event_data={
            "order_id": str(order_id),
            "order_number": order.order_number,
            "total": str(order.total),
            "reference": payload.reference,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/waive", response_model=StoreOrderResponse)
async def waive_order_payment(
    order_id: str,
    payload: StoreOrderWaive,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Comp an order — the department is not collecting on it."""
    service = StorefrontService(db)
    try:
        order = await service.waive_order_payment(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            reason=payload.reason,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_order_payment_waived",
        event_category="storefront",
        severity="warning",
        event_data={
            "order_id": str(order_id),
            "order_number": order.order_number,
            "total": str(order.total),
            "reason": payload.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/bulk-payment", response_model=StoreBulkStatusResult)
async def bulk_mark_orders_paid(
    payload: StoreBulkPayment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Settle many orders at once — reconciling a payout statement."""
    service = StorefrontService(db)
    result = await service.bulk_mark_paid(
        str(current_user.organization_id),
        payload.order_ids,
        str(current_user.id),
        payment_method=payload.payment_method,
        reference=payload.reference,
        notify_members=payload.notify_members,
    )
    await log_audit_event(
        db=db,
        event_type="store_orders_bulk_marked_paid",
        event_category="storefront",
        severity="info",
        event_data={
            "requested": len(payload.order_ids),
            "updated": result["updated"],
            "skipped": result["skipped"],
            "reference": payload.reference,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


@router.post("/orders/{order_id}/refund", response_model=StoreOrderResponse)
async def refund_order(
    order_id: str,
    payload: StoreOrderRefund,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Record a refund issued outside the app."""
    service = StorefrontService(db)
    try:
        order = await service.refund_order(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            amount=payload.amount,
            reason=payload.reason,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    await log_audit_event(
        db=db,
        event_type="store_refund_recorded",
        event_category="storefront",
        severity="warning",
        event_data={
            "order_id": str(order_id),
            "amount": str(payload.amount) if payload.amount else "full",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/cancel", response_model=StoreOrderResponse)
async def cancel_order(
    order_id: str,
    payload: StoreOrderCancel,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Cancel any order in the organization."""
    service = StorefrontService(db)
    try:
        order = await service.cancel_order(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            reason=payload.reason,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/{order_id}/messages", response_model=StoreOrderResponse)
async def add_order_message(
    order_id: str,
    payload: StoreOrderMessage,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Post an update to the order timeline, optionally emailing the member."""
    service = StorefrontService(db)
    try:
        order = await service.add_order_message(
            order_id,
            str(current_user.organization_id),
            str(current_user.id),
            payload.message,
            is_member_visible=payload.is_member_visible,
            notify_member=payload.notify_member,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.put("/orders/{order_id}/notes", response_model=StoreOrderResponse)
async def set_order_notes(
    order_id: str,
    payload: StoreOrderAdminNotes,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Replace the internal notes on an order."""
    service = StorefrontService(db)
    try:
        order = await service.set_admin_notes(
            order_id, str(current_user.organization_id), payload.admin_notes
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=safe_error_detail(exc))
    settings = await service.get_settings(str(current_user.organization_id))
    return _order_payload(order, service, settings, include_internal=True)


@router.post("/orders/bulk-status", response_model=StoreBulkStatusResult)
async def bulk_update_order_status(
    payload: StoreBulkStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Advance many orders at once (e.g. mark a whole window ready for pickup)."""
    service = StorefrontService(db)
    return await service.bulk_update_status(
        str(current_user.organization_id),
        payload.order_ids,
        payload.status,
        str(current_user.id),
        message=payload.message,
        notify_members=payload.notify_members,
    )


@router.get("/permissions")
async def get_store_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, bool]:
    """Lightweight capability probe so the UI can hide what the user can't do."""
    return {
        "can_view": user_has_permission(current_user, "storefront.view"),
        "can_order": user_has_permission(current_user, "storefront.order"),
        "can_manage": user_has_permission(current_user, "storefront.manage"),
    }


# ==========================================================================
# External payment reconciliation
# ==========================================================================


def _payment_event_payload(event: Any) -> Dict[str, Any]:
    """Shape one inbound payment, with enough of the order to act on it."""
    order = getattr(event, "matched_order", None)
    balance: Optional[Decimal] = None
    if order is not None:
        balance = max(
            Decimal(order.total or 0) - Decimal(order.amount_paid or 0), Decimal("0")
        )
    return {
        "id": event.id,
        "provider": event.provider,
        "external_id": event.external_id,
        "amount": event.amount,
        "currency": event.currency,
        "payer_name": event.payer_name,
        "payer_email": event.payer_email,
        "reference": event.reference,
        "status": event.status,
        "note": event.note,
        "matched_order_id": event.matched_order_id,
        "matched_order_number": order.order_number if order else None,
        "matched_order_member": order.customer_name if order else None,
        "matched_order_balance": balance,
        "received_at": event.received_at,
        "resolved_at": event.resolved_at,
    }


@router.get("/payments", response_model=StorePaymentEventListResponse)
async def list_payment_events(
    status_filter: Optional[str] = Query(None, alias="status"),
    unresolved_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Inbound payments a connected provider reported, newest first."""
    service = StorefrontService(db)
    org_id = str(current_user.organization_id)
    events = await service.list_payment_events(
        org_id,
        status=status_filter,
        unresolved_only=unresolved_only,
        limit=limit,
    )
    # Counted independently of the current filter so the review badge does not
    # disappear the moment somebody filters the list to something else.
    unresolved = await service.count_unresolved_payment_events(org_id)
    return {
        "items": [_payment_event_payload(event) for event in events],
        "unresolved_count": unresolved,
    }


@router.post("/payments/{event_id}/apply", response_model=StorePaymentEventResponse)
async def apply_payment_event(
    event_id: str,
    payload: StorePaymentEventApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Settle an order from a recorded payment."""
    service = StorefrontService(db)
    try:
        event = await service.apply_payment_event(
            event_id,
            str(current_user.organization_id),
            str(current_user.id),
            order_id=payload.order_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    await log_audit_event(
        db=db,
        event_type="store_payment_applied",
        event_category="storefront",
        severity="info",
        event_data={
            "payment_event_id": event_id,
            "provider": event.provider,
            "order_id": event.matched_order_id,
            "amount": str(event.amount),
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )
    return _payment_event_payload(event)


@router.post("/payments/{event_id}/ignore", response_model=StorePaymentEventResponse)
async def ignore_payment_event(
    event_id: str,
    payload: StorePaymentEventIgnore,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("storefront.manage")),
) -> Any:
    """Dismiss a payment that does not belong to any store order."""
    service = StorefrontService(db)
    try:
        event = await service.ignore_payment_event(
            event_id,
            str(current_user.organization_id),
            str(current_user.id),
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))

    await log_audit_event(
        db=db,
        event_type="store_payment_ignored",
        event_category="storefront",
        severity="info",
        event_data={
            "payment_event_id": event_id,
            "provider": event.provider,
            "reason": payload.reason,
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )
    return _payment_event_payload(event)
