"""Create fundraising module tables

Revision ID: 20260201_0017
Revises: 20260201_0016
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260201_0017'
down_revision = '20260201_0016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create fundraising_campaigns table - Main fundraising campaigns/events
    op.create_table(
        'fundraising_campaigns',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('campaign_type', sa.Enum('general', 'equipment', 'training', 'community', 'memorial', 'event', 'other', name='campaigntype'), nullable=False),
        sa.Column('goal_amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('current_amount', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date()),
        sa.Column('status', sa.Enum('draft', 'active', 'paused', 'completed', 'cancelled', name='campaignstatus'), nullable=False, server_default='draft'),
        sa.Column('public_page_enabled', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('public_page_url', sa.String(255)),
        sa.Column('hero_image_url', sa.String(500)),
        sa.Column('thank_you_message', sa.Text()),
        sa.Column('allow_anonymous', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('minimum_donation', sa.Numeric(10, 2)),
        sa.Column('suggested_amounts', sa.JSON()),
        sa.Column('custom_fields', sa.JSON()),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_fundraising_campaigns_org', 'fundraising_campaigns', ['organization_id'])
    op.create_index('idx_fundraising_campaigns_status', 'fundraising_campaigns', ['organization_id', 'status'])
    op.create_index('idx_fundraising_campaigns_type', 'fundraising_campaigns', ['organization_id', 'campaign_type'])
    op.create_index('idx_fundraising_campaigns_dates', 'fundraising_campaigns', ['start_date', 'end_date'])

    # Create donors table - Track donor information
    op.create_table(
        'donors',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('first_name', sa.String(100), nullable=False),
        sa.Column('last_name', sa.String(100), nullable=False),
        sa.Column('email', sa.String(255)),
        sa.Column('phone', sa.String(20)),
        sa.Column('address_line1', sa.String(255)),
        sa.Column('address_line2', sa.String(255)),
        sa.Column('city', sa.String(100)),
        sa.Column('state', sa.String(50)),
        sa.Column('postal_code', sa.String(20)),
        sa.Column('country', sa.String(100), server_default='USA'),
        sa.Column('donor_type', sa.Enum('individual', 'business', 'foundation', 'government', 'other', name='donortype'), nullable=False, server_default='individual'),
        sa.Column('company_name', sa.String(255)),
        sa.Column('total_donated', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('donation_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('first_donation_date', sa.Date()),
        sa.Column('last_donation_date', sa.Date()),
        sa.Column('notes', sa.Text()),
        sa.Column('tags', sa.JSON()),
        sa.Column('communication_preferences', sa.JSON()),
        sa.Column('is_anonymous', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_donors_org', 'donors', ['organization_id'])
    op.create_index('idx_donors_user', 'donors', ['user_id'])
    op.create_index('idx_donors_email', 'donors', ['organization_id', 'email'])
    op.create_index('idx_donors_type', 'donors', ['organization_id', 'donor_type'])
    op.create_index('idx_donors_name', 'donors', ['organization_id', 'last_name', 'first_name'])

    # Create donations table - Individual donation records
    op.create_table(
        'donations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.String(36), sa.ForeignKey('fundraising_campaigns.id', ondelete='SET NULL'), nullable=True),
        sa.Column('donor_id', sa.String(36), sa.ForeignKey('donors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='USD'),
        sa.Column('donation_date', sa.DateTime(), nullable=False),
        sa.Column('payment_method', sa.Enum('cash', 'check', 'credit_card', 'bank_transfer', 'paypal', 'venmo', 'other', name='paymentmethod'), nullable=False),
        sa.Column('payment_status', sa.Enum('pending', 'completed', 'failed', 'refunded', 'cancelled', name='paymentstatus'), nullable=False, server_default='completed'),
        sa.Column('transaction_id', sa.String(255)),
        sa.Column('check_number', sa.String(50)),
        sa.Column('is_recurring', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('recurring_frequency', sa.Enum('weekly', 'monthly', 'quarterly', 'annually', name='recurringfrequency')),
        sa.Column('is_anonymous', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('donor_name', sa.String(255)),
        sa.Column('donor_email', sa.String(255)),
        sa.Column('dedication_type', sa.Enum('in_honor', 'in_memory', name='dedicationtype')),
        sa.Column('dedication_name', sa.String(255)),
        sa.Column('notes', sa.Text()),
        sa.Column('receipt_sent', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('receipt_sent_at', sa.DateTime()),
        sa.Column('thank_you_sent', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('thank_you_sent_at', sa.DateTime()),
        sa.Column('tax_deductible', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('custom_fields', sa.JSON()),
        sa.Column('recorded_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_donations_org', 'donations', ['organization_id'])
    op.create_index('idx_donations_campaign', 'donations', ['campaign_id'])
    op.create_index('idx_donations_donor', 'donations', ['donor_id'])
    op.create_index('idx_donations_date', 'donations', ['donation_date'])
    op.create_index('idx_donations_status', 'donations', ['organization_id', 'payment_status'])
    op.create_index('idx_donations_method', 'donations', ['organization_id', 'payment_method'])

    # Create pledges table - Donation pledges/commitments
    op.create_table(
        'pledges',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.String(36), sa.ForeignKey('fundraising_campaigns.id', ondelete='SET NULL'), nullable=True),
        sa.Column('donor_id', sa.String(36), sa.ForeignKey('donors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('pledged_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('fulfilled_amount', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('pledge_date', sa.Date(), nullable=False),
        sa.Column('due_date', sa.Date()),
        sa.Column('status', sa.Enum('pending', 'partial', 'fulfilled', 'cancelled', 'overdue', name='pledgestatus'), nullable=False, server_default='pending'),
        sa.Column('payment_schedule', sa.JSON()),
        sa.Column('reminder_enabled', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('last_reminder_sent', sa.DateTime()),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_pledges_org', 'pledges', ['organization_id'])
    op.create_index('idx_pledges_campaign', 'pledges', ['campaign_id'])
    op.create_index('idx_pledges_donor', 'pledges', ['donor_id'])
    op.create_index('idx_pledges_status', 'pledges', ['organization_id', 'status'])
    op.create_index('idx_pledges_due_date', 'pledges', ['due_date'])

    # Create fundraising_events table - Events tied to fundraising (dinners, galas, etc.)
    op.create_table(
        'fundraising_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.String(36), sa.ForeignKey('fundraising_campaigns.id', ondelete='CASCADE'), nullable=True),
        sa.Column('event_id', sa.String(36), sa.ForeignKey('events.id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('event_type', sa.Enum('dinner', 'gala', 'auction', 'raffle', 'golf_outing', 'walkathon', 'other', name='fundraisingeventtype'), nullable=False),
        sa.Column('event_date', sa.DateTime(), nullable=False),
        sa.Column('location', sa.String(300)),
        sa.Column('ticket_price', sa.Numeric(10, 2)),
        sa.Column('max_attendees', sa.Integer()),
        sa.Column('current_attendees', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revenue_goal', sa.Numeric(12, 2)),
        sa.Column('actual_revenue', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('expenses', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('status', sa.Enum('planning', 'open', 'sold_out', 'completed', 'cancelled', name='fundraisingeventstatus'), nullable=False, server_default='planning'),
        sa.Column('registration_url', sa.String(500)),
        sa.Column('sponsors', sa.JSON()),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_fundraising_events_org', 'fundraising_events', ['organization_id'])
    op.create_index('idx_fundraising_events_campaign', 'fundraising_events', ['campaign_id'])
    op.create_index('idx_fundraising_events_date', 'fundraising_events', ['event_date'])
    op.create_index('idx_fundraising_events_status', 'fundraising_events', ['organization_id', 'status'])


def downgrade() -> None:
    op.drop_table('fundraising_events')
    op.drop_table('pledges')
    op.drop_table('donations')
    op.drop_table('donors')
    op.drop_table('fundraising_campaigns')
