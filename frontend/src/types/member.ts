/**
 * Member Types
 *
 * Defines the member structure for the membership management module.
 */

export interface EmergencyContact {
  id?: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface ContactInfo {
  primaryPhone: string;
  secondaryPhone?: string;
  email: string;
  preferredContact: 'phone' | 'email' | 'text';
}

export interface Certification {
  id?: string;
  name: string;
  issueDate: string;
  expirationDate: string;
  certificationNumber?: string;
  issuingOrganization?: string;
  status: 'active' | 'expiring' | 'expired';
}

export interface Member {
  id: string;
  departmentId: string; // Department-specific ID number

  // Personal Info
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string;

  // Contact Info
  homeAddress: Address;
  contactInfo: ContactInfo;

  // Emergency Contacts
  emergencyContacts: EmergencyContact[];

  // Department Info
  joinDate: string;
  status: 'active' | 'inactive' | 'leave' | 'retired';
  rank?: string;
  role?: string;
  station?: string;

  // Certifications
  certifications?: Certification[];

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  photoUrl?: string;
}

export interface MemberFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  departmentId: string;
  dateOfBirth: string;

  // Address
  street: string;
  city: string;
  state: string;
  zipCode: string;

  // Contact
  primaryPhone: string;
  secondaryPhone: string;
  email: string;
  preferredContact: 'phone' | 'email' | 'text';

  // Department
  joinDate: string;
  status: 'active' | 'inactive' | 'leave' | 'retired';
  rank: string;
  role: string;
  station: string;

  // Emergency Contact 1
  emergencyName1: string;
  emergencyRelationship1: string;
  emergencyPhone1: string;
  emergencyEmail1: string;

  // Emergency Contact 2 (optional)
  emergencyName2: string;
  emergencyRelationship2: string;
  emergencyPhone2: string;
  emergencyEmail2: string;
}

export interface CSVMemberRow {
  firstName: string;
  lastName: string;
  middleName?: string;
  departmentId: string;
  dateOfBirth?: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  primaryPhone: string;
  secondaryPhone?: string;
  email: string;
  joinDate: string;
  status?: string;
  rank?: string;
  role?: string;
  station?: string;
  emergencyName1: string;
  emergencyRelationship1: string;
  emergencyPhone1: string;
  emergencyEmail1?: string;
  emergencyName2?: string;
  emergencyRelationship2?: string;
  emergencyPhone2?: string;
  emergencyEmail2?: string;
}

export interface MemberStats {
  total: number;
  active: number;
  inactive: number;
  onLeave: number;
  retired: number;
  expiringCertifications: number;
}
